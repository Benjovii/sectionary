import { Suspense } from "react";
import { Wall, WallSkeleton } from "@/components/wall";

export default function Home() {
  return (
    <Suspense fallback={<WallSkeleton />}>
      <Wall />
    </Suspense>
  );
}
