import { redirect } from "next/navigation";

export default function EmailTemplatesPage() {
  redirect("/admin/communications?tab=email-templates");
}
