import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/ImportCenter";
export const Route = createFileRoute("/_authenticated/import")({ component: Page });
