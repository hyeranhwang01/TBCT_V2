"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RuntimeEscalationsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/runtime/safety/events");
  }, [router]);
  return null;
}
