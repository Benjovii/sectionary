import { redirect } from "next/navigation";

// The "Pages" tab became Flows (SEC-20): a store's pages in shopping order.
// Kept so old links still land somewhere.
export default function PagesRoute() {
  redirect("/flows");
}
