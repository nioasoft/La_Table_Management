import { redirect } from "next/navigation";

export default function FranchiseeRemindersPage() {
  redirect("/admin/communications?tab=reminders");
}
