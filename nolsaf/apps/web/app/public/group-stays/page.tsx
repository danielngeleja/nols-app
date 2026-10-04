import type { Metadata } from "next";
import React from "react";
import GroupStaysCard from "../../../components/GroupStaysCard";
import { SITE_URL, seoKeywords } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Group Stays in Tanzania & East Africa",
  description:
    "Request verified group accommodation across Tanzania and East Africa with multi-room coordination, owner offers, transport support and flexible payments.",
  keywords: [
    "group stays Tanzania",
    "group accommodation East Africa",
    "family accommodation Tanzania",
    "corporate stays Tanzania",
    "multi room hotel booking Tanzania",
    ...seoKeywords,
  ],
  alternates: { canonical: `${SITE_URL}/public/group-stays` },
  openGraph: {
    title: "Group Stays in Tanzania & East Africa | NoLSAF",
    description: "Travelers share their group stay needs, then eligible property owners can respond with suitable accommodation offers.",
    url: `${SITE_URL}/public/group-stays`,
  },
};

export default function GroupStaysPage() {
  return (
    <main className="min-h-screen bg-[#f3f7f6] pt-20">
      <div className="public-container">
        <GroupStaysCard />
      </div>
    </main>
  );
}
