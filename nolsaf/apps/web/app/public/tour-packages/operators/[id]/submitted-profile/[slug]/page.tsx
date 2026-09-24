"use client";

import { useParams } from "next/navigation";
import { OperatorProfilePreviewScreen } from "@/app/account/agent/profile/preview/OperatorProfilePreviewScreen";
import LogoSpinner from "@/components/LogoSpinner";

export default function PublicSubmittedProfileSlugPage() {
  const params = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const publicAgentKey = String(idParam || "").trim().toLowerCase();

  if (!/^[a-z0-9]{20,40}$/.test(publicAgentKey)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LogoSpinner size="lg" />
      </div>
    );
  }

  return <OperatorProfilePreviewScreen publicAgentKey={publicAgentKey} />;
}
