import { SITE_URL } from "@/lib/seo";

/**
 * NoLSAF's founders: one source for the profile pages, the story page and the
 * site-wide structured data.
 *
 * Why this exists: a search for a founder's name should lead to NoLSAF, not
 * only to their social profiles. Each founder gets a profile page whose title,
 * heading and Person markup tie the name to the company, and `sameAs` tells
 * search engines those social profiles are the same person. Add every public
 * profile a founder uses (LinkedIn, Instagram, X…) to `sameAs`.
 */
export type Founder = {
  slug: string;
  name: string;
  /** Other spellings people search for. */
  alternateNames: string[];
  role: string;
  /** Short line for titles and cards. */
  headline: string;
  image: string;
  imageAlt: string;
  bio: string[];
  /** The intro (bio[0]) broken into lines that widen top to bottom, shown as a centred pyramid on wide screens. */
  introPyramid?: string[];
  statement?: string;
  focus: string[];
  /** How they lead, coordinate and manage. */
  leadership?: string[];
  /** Their view on technology and the service gaps it closes. */
  technology?: string[];
  /** Section headings for the two sections above (defaults are generic). */
  leadershipTitle?: string;
  technologyTitle?: string;
  /** Schools and universities attended. */
  education?: Array<{ name: string; note?: string }>;
  /** Extra subjects they are known for, for search engines. */
  topics?: string[];
  /** International forums and events attended. Only confirmed events belong here. */
  forums?: Array<{ name: string; venue: string; city: string; date: string; year: number; note?: string }>;
  sameAs: string[];
};

export const FOUNDERS: Founder[] = [
  {
    slug: "daniel-ngeleja",
    name: "Daniel M. Ngeleja",
    alternateNames: ["Daniel Ngeleja", "Daniel Mussa Ngeleja"],
    role: "Founder and CEO",
    headline: "Founder and CEO of NoLSAF",
    image: "/assets/NoLS%20Founder.jpeg",
    imageAlt: "Daniel M. Ngeleja, Founder and CEO of NoLSAF",
    bio: [
      "Daniel M. Ngeleja is the Founder and CEO of NoLSAF, a travel platform that unites verified stays, transport and tours in a single booking. Launched in Tanzania and expanding across Africa, NoLSAF is built on his background as a security-first developer, shaped by cybersecurity analysis and the Microsoft community.",
      "He brings hands-on experience from telecom digitalisation across East Africa, including taking part in the inauguration of a 5G network led by Vodacom Tanzania.",
      "At NoLSAF he leads the engineering direction: building scalable, reliable systems and a clear experience for travellers, property owners, drivers and tour operators. He is driven by artificial intelligence that makes planning smarter and more personal, while keeping the journey predictable and human.",
    ],
    // Widens line by line (32, 36, 47, 55, 68, 72 characters) and fits beside the photo and the company card
    introPyramid: [
      "Daniel M. Ngeleja is the Founder",
      "and CEO of NoLSAF, a travel platform",
      "that unites verified stays, transport and tours",
      "in a single booking. Launched in Tanzania and expanding",
      "across Africa, NoLSAF is built on his background as a security-first",
      "developer, shaped by cybersecurity analysis and the Microsoft community.",
    ],
    statement:
      "I founded NoLSAF to solve a common travel problem: the journey is often fragmented. We are building one platform that brings accommodation, transport booking and tourism discovery together, so planning feels clear, predictable and human.",
    focus: ["Engineering and security", "Product direction", "Artificial intelligence in travel planning", "Leadership and team coordination"],
    leadership: [
      "Daniel leads NoLSAF by keeping many moving parts working as one: travellers, property owners, drivers, tour operators, payment partners and the team that builds the platform. He sets a clear direction, turns it into measurable goals, and coordinates the people and partners needed to deliver them.",
      "He manages with structure and accountability: decisions are documented, work is broken into clear steps, and every release is checked against the needs of the people who use it. That discipline lets a growing platform stay reliable while it expands.",
    ],
    technology: [
      "Daniel's work starts from a gap he has seen across East Africa: good services exist, but finding, trusting and paying for them is often harder than it should be. Accommodation, transport and local experiences are offered separately, with little verification and few shared standards.",
      "He believes technology closes that gap when it is built around people rather than features: verified listings so travellers can trust what they book, mobile money and bank payments that match how people actually pay, and one booking that connects the stay, the ride and the help in between. NoLSAF is that idea in practice.",
    ],
    leadershipTitle: "Leadership and coordination",
    technologyTitle: "Technology that closes service gaps",
    topics: ["Digital services in East Africa", "Travel technology"],
    forums: [
      {
        name: "Arab Health 2025",
        venue: "Dubai World Trade Centre",
        city: "Dubai, United Arab Emirates",
        date: "27 to 30 January 2025",
        year: 2025,
        note: "One of the largest international health exhibitions, bringing together innovators, providers and technology leaders from around the world.",
      },
    ],
    sameAs: ["https://www.linkedin.com/in/daniel-mussa-ngeleja-9898a7241"],
  },
  {
    slug: "rashidi-sued-rashidi",
    name: "Rashidi Sued Rashidi",
    alternateNames: ["Rashid Sued Rashid", "Rashid Sued", "Rashidi Sued"],
    role: "Co-Founder",
    headline: "Co-Founder of NoLSAF",
    image: "/assets/Rashid%20Sued.png",
    imageAlt: "Rashidi Sued Rashidi, Co-Founder of NoLSAF",
    bio: [
      "Rashidi Sued Rashidi is a Co-Founder of NoLSAF, leading strategy, research and commercialisation for a travel platform that unites verified stays, transport and tours in a single booking.",
      "He is an alumnus of Feza International and a graduate of the University of Dar es Salaam, with a strong foundation in technology and a passion for agriculture-driven impact.",
      "He and Daniel first met during a TANTRADE-led exhibition and aligned on a shared ambition: build and lead innovation that is structured, measurable and built for real people.",
    ],
    // Widens line by line (25, 39, 52, 68 characters)
    introPyramid: [
      "Rashidi Sued Rashidi is a",
      "Co-Founder of NoLSAF, leading strategy,",
      "research and commercialisation for a travel platform",
      "that unites verified stays, transport and tours in a single booking.",
    ],
    focus: ["Strategy and research", "Commercialisation and growth", "Technology in food science", "Inclusive economy"],
    leadershipTitle: "Leadership and strategy",
    leadership: [
      "Rashidi leads with a strategist's eye: he finds the market niches others overlook and turns those insights into clear plans the team can execute. At NoLSAF he shapes how the platform grows, where it focuses next, and how each step is measured.",
      "He applies data-driven decision-making to drive growth and return on investment, and he is an advocate for an inclusive economy and a champion of the UN Sustainable Development Goals, so that growth reaches the people and businesses the platform serves.",
    ],
    technologyTitle: "Technology in food science",
    technology: [
      "Rashidi is an advocate for technology in food science: using data, digital tools and better processes to improve how food is produced, handled and brought to market. It connects directly with his passion for agriculture-driven impact.",
      "He sees the same principle at work in travel and hospitality. When technology is built around real needs, it raises quality, reduces waste and opens new opportunities for local businesses. That thinking shapes the research and commercialisation he brings to NoLSAF.",
    ],
    education: [
      { name: "University of Dar es Salaam", note: "Graduate" },
      { name: "Feza International", note: "Alumnus" },
    ],
    topics: ["Food science technology", "Agriculture", "Business strategy"],
    sameAs: ["https://www.linkedin.com/in/rashidi-sued-rashidi-957959206"],
  },
];

export const founderUrl = (f: Founder) => `${SITE_URL}/founders/${f.slug}`;
export const founderId = (f: Founder) => `${founderUrl(f)}#person`;

/** Person markup for one founder, linked to the NoLSAF organisation. */
export function founderPersonJsonLd(f: Founder) {
  return {
    "@type": "Person",
    "@id": founderId(f),
    name: f.name,
    alternateName: f.alternateNames,
    jobTitle: f.role,
    description: f.bio[0],
    image: `${SITE_URL}${f.image}`,
    url: founderUrl(f),
    sameAs: f.sameAs,
    knowsAbout: [...f.focus, ...(f.topics ?? [])],
    ...(f.education?.length ? { alumniOf: f.education.map((e) => ({ "@type": "EducationalOrganization", name: e.name })) } : {}),
    worksFor: { "@id": `${SITE_URL}/#organization` },
    affiliation: { "@id": `${SITE_URL}/#organization` },
    nationality: { "@type": "Country", name: "Tanzania" },
  };
}
