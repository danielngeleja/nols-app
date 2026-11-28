"use client";

import type { PropsWithChildren } from "react";

type AddPropertySectionProps = PropsWithChildren<{
  /** Wrapper element */
  as?: "section" | "div";
  /** Forwarded ref used for scroll-to-step behavior */
  sectionRef?: (el: HTMLElement | null) => void;
  /** Toggle visibility */
  isVisible: boolean;
  /** Extra classes appended to the wrapper */
  className?: string;
  /** Optional id for anchors/testing */
  id?: string;
}>;

export function AddPropertySection({
  as = "section",
  sectionRef,
  isVisible,
  className = "",
  id,
  children,
}: AddPropertySectionProps) {
  const Tag = as as any;

  // Keep children mounted to preserve step drafts, but make visibility explicit.
  // Unlayered surface CSS can override Tailwind's `hidden` utility.
  return (
    <Tag
      id={id}
      ref={sectionRef as any}
      hidden={!isVisible}
      style={isVisible ? undefined : { display: "none" }}
      className={`${className} ${isVisible ? "block nls-flipbook" : "hidden"}`}
    >
      {children}
    </Tag>
  );
}


