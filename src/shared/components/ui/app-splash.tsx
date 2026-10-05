"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/shared/components/ui/logo";
import { BOARD_BACKGROUND, BrandMark, GRAIN } from "@/patient/components/ui/kit";

// Patient routes are /…/patient and /…/patient/… (login and sign-up
// included); the clinician's /patients/… monitoring pages are not.
const PATIENT_ROUTE = /\/patient(\/|$)/;

export function AppSplash() {
  const [visible, setVisible] = useState(true);
  const pathname = usePathname() ?? "";
  // On patient routes the cover is the patient app's own: the deep-green
  // board with the lab mark (note2026_10_05_patient_auth_v2_look). Elsewhere
  // it stays as it was.
  const patient = PATIENT_ROUTE.test(pathname);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 850);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {visible && patient && (
        <motion.div
          className="app-splash text-white"
          style={{ background: BOARD_BACKGROUND, fontFamily: "'Pretendard Variable', Pretendard, system-ui, sans-serif" }}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28 }}
          aria-label="TBCT 불러오는 중"
        >
          <div className="pointer-events-none absolute inset-0 opacity-[0.08] mix-blend-overlay" style={{ backgroundImage: GRAIN }} aria-hidden="true" />
          <motion.div initial={{ scale: 0.86, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 240, damping: 20 }}>
            <BrandMark className="h-20 w-20 drop-shadow-xl" />
          </motion.div>
          <div className="mt-5 text-[28px] font-extrabold tracking-[-0.04em]">TBCT</div>
          <div className="mt-1 text-[14px] text-white/70">마음을 이해하는 안전한 대화</div>
          <div className="mt-7 h-1 w-24 overflow-hidden rounded-full bg-white/15">
            <motion.div className="h-full rounded-full bg-[rgb(232,180,68)]" initial={{ x: "-100%" }} animate={{ x: "100%" }} transition={{ duration: 0.75, ease: "easeInOut" }} />
          </div>
        </motion.div>
      )}
      {visible && !patient && (
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
