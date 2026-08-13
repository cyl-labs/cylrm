import { redirect } from "next/navigation";
import { WORKSPACES } from "@/lib/workspace";

/**
 * The front door lands in the Call CRM.
 *
 * That is where the people signing in spend their day — the email side runs
 * itself on the scheduler and is checked, not worked. Both `/` and the
 * redirect after login come through here, so there is one place that decides.
 */
export default function Home() {
  redirect(WORKSPACES.find((w) => w.id === "call")!.home);
}
