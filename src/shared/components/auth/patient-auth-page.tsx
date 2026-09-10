"use client";

import { AuthForm } from "@/shared/components/auth/auth-form";

export function PatientAuthPage() {
  return <AuthForm role="patient" titleKey="auth.patientTitle" redirectTo="/projects/demo/patient" />;
}
