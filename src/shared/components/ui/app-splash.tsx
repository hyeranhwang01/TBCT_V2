"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Logo } from "@/shared/components/ui/logo";

export function AppSplash() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 850);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div className="app-splash" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }} aria-label="TBCT 불러오는 중">
          <motion.div initial={{ scale: 0.86, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 20 }}>
            <Logo className="h-20 w-20 drop-shadow-xl" />
          </motion.div>
          <div className="rainbow-text mt-5 text-2xl font-black tracking-[-0.04em]">TBCT</div>
          <div className="mt-1 text-sm text-text-secondary">마음을 이해하는 안전한 대화</div>
          <div className="mt-6 h-1 w-24 overflow-hidden rounded-full bg-white/50">
            <motion.div className="rainbow-fill h-full rounded-full" initial={{ x: "-100%" }} animate={{ x: "100%" }} transition={{ duration: 0.75, ease: "easeInOut" }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
