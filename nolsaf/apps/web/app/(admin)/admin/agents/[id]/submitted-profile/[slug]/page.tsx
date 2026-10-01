"use client";

import { useParams } from "next/navigation";
import { OperatorProfilePreviewScreen } from "@/app/account/agent/profile/preview/OperatorProfilePreviewScreen";
import AdminRecordGate from "@/components/admin/AdminRecordGate";

export default function SubmittedProfileSlugPage() {
  const params = useParams<{ id?: string | string[] }>();

  return (
    <AdminRecordGate kind="agent" param={params?.id} backHref="/admin/agents">
      {(adminAgentId) => <OperatorProfilePreviewScreen adminAgentId={adminAgentId} />}
    </AdminRecordGate>
  );
}
