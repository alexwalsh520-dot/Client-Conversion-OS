import ReviewClient from "./ReviewClient";
import "./review.css";

export const metadata = { title: "Factory Review" };
export const dynamic = "force-dynamic";

export default function FactoryReviewPage() {
  return <ReviewClient />;
}
