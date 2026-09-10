import Image from "next/image";

export function Logo({ className }: { className?: string }) {
  return (
    <Image src="/brand/tbct-rainbow-mark.png" width={160} height={160} priority className={className} alt="TBCT" />
  );
}
