/**
 * ActiveProjectProvider — global "which project am I working on" state.
 *
 * Persists the selected project_code on the signed-in user's row in
 * `public.profiles` (`active_project_code`) so the choice follows the user
 * across browsers, devices, and fresh sessions. localStorage is kept as a
 * fast local cache so the UI hydrates instantly on refresh before the
 * profile round-trip completes, and as a fallback for unauthenticated
 * flows (tests, print views).
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Detect a Postgres/PostgREST error caused by RLS. Supabase surfaces
 * these as either an explicit "row-level security" message, code `42501`
 * (insufficient_privilege), or PostgREST's `PGRST301` (JWT/permission).
 */
function isRlsError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "42501" || err.code === "PGRST301") return true;
  const msg = (err.message ?? "").toLowerCase();
  return msg.includes("row-level security") || msg.includes("row level security");
}

export type ProjectRow = { project_code: string; project_name: string };

type Ctx = {
  projects: ProjectRow[];
  loading: boolean;
  activeCode: string | null;
  activeProject: ProjectRow | null;
  setActiveCode: (code: string) => void;
};

const ActiveProjectContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "erp:active-project-code";

export function ActiveProjectProvider({ children }: { children: ReactNode }) {
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["active-project", "projects"],
    queryFn: async (): Promise<ProjectRow[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("project_code, project_name")
        .order("project_name");
      if (error) throw error;
      return (data ?? []) as ProjectRow[];
    },
  });

  const [userId, setUserId] = useState<string | null>(null);
  const [activeCode, setActiveCodeState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });
  // Suppress the initial profile→state hydration from writing back to the DB.
  const hydratedFromRemote = useRef(false);

  // Track auth state so we know whose profile row to read/write.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserId(session?.user?.id ?? null);
      // Force a re-hydrate from the newly signed-in user's profile.
      hydratedFromRemote.current = false;
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Load the persisted active_project_code from profiles for the current user.
  const { data: remoteCode } = useQuery({
    queryKey: ["active-project", "remote", userId],
    enabled: !!userId,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("active_project_code")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return (data?.active_project_code as string | null) ?? null;
    },
  });

  // Hydrate local state from the profile row exactly once per sign-in.
  useEffect(() => {
    if (!userId || hydratedFromRemote.current) return;
    if (remoteCode === undefined) return; // query not settled yet
    hydratedFromRemote.current = true;
    if (remoteCode && remoteCode !== activeCode) {
      setActiveCodeState(remoteCode);
    }
  }, [userId, remoteCode, activeCode]);

  // Once projects load, guarantee activeCode points at a real project. If the
  // saved code no longer exists (project deleted or bad first-run state),
  // fall back to the first project.
  useEffect(() => {
    if (isLoading || projects.length === 0) return;
    const exists = activeCode && projects.some((p) => p.project_code === activeCode);
    if (!exists) {
      setActiveCodeState(projects[0].project_code);
    }
  }, [isLoading, projects, activeCode]);

  // Local cache: instant hydration on refresh.
  useEffect(() => {
    if (typeof window === "undefined" || !activeCode) return;
    window.localStorage.setItem(STORAGE_KEY, activeCode);
  }, [activeCode]);

  // Remote persistence: mirror the selection to the user's profile row so
  // it follows them to other browsers/devices. Skip the very first sync
  // that just echoes what we already read from the profile.
  useEffect(() => {
    if (!userId || !activeCode) return;
    if (!hydratedFromRemote.current) return;
    if (remoteCode === activeCode) return;
    let cancelled = false;
    const attemptedCode = activeCode;
    const previousCode = remoteCode ?? null;

    const persist = async () => {
      // `.select()` returns the affected rows so we can distinguish an
      // RLS-silenced update (0 rows, no error) from a real success.
      const { data, error } = await supabase
        .from("profiles")
        .update({ active_project_code: attemptedCode })
        .eq("id", userId)
        .select("id");

      if (cancelled) return;

      if (error) {
        const rls = isRlsError(error);
        console.warn("[activeProject] failed to persist to profile:", error.message);
        toast.error(
          rls
            ? "You don't have permission to change this project selection."
            : "Couldn't save your project selection.",
          {
            description: rls
              ? "Your account can only update its own profile. Try signing out and back in, or retry."
              : error.message,
            action: { label: "Retry", onClick: () => void persist() },
          },
        );
        if (previousCode && previousCode !== attemptedCode) {
          setActiveCodeState(previousCode);
        }
        return;
      }

      if (!data || data.length === 0) {
        // Update ran with no error but touched 0 rows — classic RLS block
        // (policy filtered the row out) or the profile row is missing.
        toast.error("Your project selection wasn't saved.", {
          description:
            "The database rejected the update (row-level security). Retry, or sign out and back in.",
          action: { label: "Retry", onClick: () => void persist() },
        });
        if (previousCode && previousCode !== attemptedCode) {
          setActiveCodeState(previousCode);
        }
      }
    };

    void persist();
    return () => {
      cancelled = true;
    };
  }, [userId, activeCode, remoteCode]);

  // Sync across tabs — if a sibling tab switches projects, follow along.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && e.newValue !== activeCode) {
        setActiveCodeState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [activeCode]);

  const activeProject = useMemo(
    () => projects.find((p) => p.project_code === activeCode) ?? null,
    [projects, activeCode],
  );

  const value: Ctx = {
    projects,
    loading: isLoading,
    activeCode,
    activeProject,
    setActiveCode: (code: string) => setActiveCodeState(code),
  };

  return <ActiveProjectContext.Provider value={value}>{children}</ActiveProjectContext.Provider>;
}

export function useActiveProject(): Ctx {
  const ctx = useContext(ActiveProjectContext);
  if (!ctx) {
    // Safe fallback so components that render outside the provider (tests,
    // print flows) don't crash — they just get an empty project list.
    return {
      projects: [],
      loading: false,
      activeCode: null,
      activeProject: null,
      setActiveCode: () => {},
    };
  }
  return ctx;
}
