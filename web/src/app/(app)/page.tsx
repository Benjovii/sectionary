import { Suspense } from "react";
import { Wall, WallFallback } from "@/components/wall";

export default function Home() {
  return (
    <Suspense fallback={<WallFallback />}>
      <Wall />
    </Suspense>
  );
}
