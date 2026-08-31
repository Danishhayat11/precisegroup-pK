import { createFileRoute } from "@tanstack/react-router";
import Page from "@/pages/LogicNotes";
export const Route = createFileRoute("/_authenticated/logic")({ component: Page });
