import { createFileRoute } from "@tanstack/react-router";
import Inspections from "@/pages/Inspections";

export const Route = createFileRoute("/_authenticated/inspections")({
  component: Inspections,
});
