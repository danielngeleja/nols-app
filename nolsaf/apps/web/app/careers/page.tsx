"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { 
  Search, 
  MapPin, 
  Briefcase, 
  Clock, 
  DollarSign, 
  ChevronRight, 
  X, 
  CheckCircle2,
  Building2,
  Users,
  Heart,
  TrendingUp,
  Globe,
  Filter,
  Calendar,
  RefreshCw,
} from "lucide-react";
import AgentFooter from "@/components/AgentFooter";
import AgentPortalHeader from "@/components/AgentPortalHeader";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import SiteHeader from "@/components/SiteHeader";
import OwnerSiteHeader from "@/components/OwnerSiteHeader";
import DriverSiteHeader from "@/components/DriverSiteHeader";
import SiteFooter from "@/components/SiteFooter";
import LayoutFrame from "@/components/LayoutFrame";
import CareersApplicationForm from "@/components/careers/CareersApplicationForm";
import { usePathname } from "next/navigation";

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

type JobType =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "INTERNSHIP"
  | "FREELANCE"
  | "PARTNERSHIP"
  | "AGENCY_AGREEMENT"
  | "RESELLER"
  | "AFFILIATE"
  | "WHITE_LABEL";
type JobCategory = "ENGINEERING" | "DESIGN" | "MARKETING" | "SALES" | "OPERATIONS" | "SUPPORT" | "MANAGEMENT" | "OTHER";
type JobLocation = "REMOTE" | "ONSITE" | "HYBRID";

interface Job {
  id: string;
  title: string;
  department: string;
  category: JobCategory;
  type: JobType;
  location: JobLocation;
  locationDetail?: string;
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: "MONTHLY" | "YEARLY";
  };
  description: string;
  requirements: string[];
  responsibilities: string[];
  benefits: string[];
  postedDate: string;
  applicationDeadline?: string;
  experienceLevel: "ENTRY" | "MID" | "SENIOR" | "LEAD";
  featured?: boolean;
  isTravelAgentPosition?: boolean;
}

// Jobs will be fetched from API - sample data removed

function JobCard({ job, onClick }: { job: Job; onClick: () => void }) {
  const formatSalary = (salary?: Job["salary"]) => {
    if (!salary || (!salary.min && !salary.max)) return "Competitive";
    const currency = salary.currency || "TZS";
    const period = salary.period === "YEARLY" ? "year" : "month";
    if (salary.min && salary.max) {
      return `${(salary.min / 1000).toFixed(0)}K - ${(salary.max / 1000).toFixed(0)}K ${currency}/${period}`;
    }
    return `${((salary.min || salary.max || 0) / 1000).toFixed(0)}K ${currency}/${period}`;
  };

  const getTypeColor = (type: JobType) => {
    switch (type) {
      case "FULL_TIME": return "bg-green-100 text-green-800";
      case "PART_TIME": return "bg-blue-100 text-blue-800";
      case "CONTRACT": return "bg-purple-100 text-purple-800";
      case "INTERNSHIP": return "bg-yellow-100 text-yellow-800";
      case "FREELANCE": return "bg-orange-100 text-orange-800";
      case "PARTNERSHIP": return "bg-emerald-100 text-emerald-800";
      case "AGENCY_AGREEMENT": return "bg-cyan-100 text-cyan-800";
      case "RESELLER": return "bg-indigo-100 text-indigo-800";
      case "AFFILIATE": return "bg-teal-100 text-teal-800";
      case "WHITE_LABEL": return "bg-slate-200 text-slate-800";
      default: return "bg-slate-100 text-slate-700";
    }
  };

  const getLocationIcon = (location: JobLocation) => {
    switch (location) {
      case "REMOTE": return <Globe size={14} className="flex-shrink-0 text-blue-600" />;
      case "ONSITE": return <Building2 size={14} className="flex-shrink-0 text-gray-700" />;
      case "HYBRID": return <RefreshCw size={14} className="flex-shrink-0 text-purple-600" />;
    }
  };

  return (
    <div
      onClick={onClick}
      className={`group bg-white rounded-2xl shadow-sm border border-solid cursor-pointer transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
        job.featured 
          ? "border-[#02665e]/30 shadow-md ring-1 ring-[#02665e]/10" 
          : "border-gray-200/60 hover:border-[#02665e]/30"
      }`}
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
              {job.featured && (
                <span className="px-2.5 py-1 text-xs font-semibold bg-gradient-to-r from-[#02665e] to-[#038a7c] text-white rounded-md shadow-sm">
                  Featured
                </span>
              )}
              <h3 className="text-xl font-bold text-gray-900 group-hover:text-[#02665e] transition-colors">
                {job.title}
              </h3>
            </div>
            <p className="text-sm font-medium text-gray-500 mb-4">{job.department}</p>
          </div>
          <ChevronRight className="text-gray-300 group-hover:text-[#02665e] flex-shrink-0 transition-colors mt-1" size={20} />
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${getTypeColor(job.type)} shadow-sm`}>
            {job.type.replace(/_/g, " ")}
          </span>
          <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-gray-700 flex items-center gap-1.5 border border-solid border-gray-200/50">
            {getLocationIcon(job.location)} 
            <span className="capitalize">{job.location.toLowerCase()}</span>
          </span>
          {job.locationDetail && (
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-gray-700 flex items-center gap-1.5 border border-solid border-gray-200/50">
              <MapPin size={14} className="text-gray-500" /> 
              {job.locationDetail}
            </span>
          )}
          <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-50 text-gray-700 border border-solid border-gray-200/50">
            {job.experienceLevel}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-600 mb-5 line-clamp-2 leading-relaxed">{job.description}</p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-0 border-t border-solid border-gray-100">
          <div className="flex flex-col gap-2 text-xs flex-1">
            <div className="flex items-center gap-4 text-gray-500">
              <span className="flex items-center gap-1.5">
                <DollarSign size={14} className="text-gray-400" />
                <span className="font-medium text-gray-700">{formatSalary(job.salary)}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-gray-500">
              <span className="flex items-center gap-1.5">
                <Calendar size={14} className="text-gray-400" />
                <span>Posted: <span className="font-medium text-gray-700">{new Date(job.postedDate).toLocaleDateString()}</span></span>
              </span>
              {job.applicationDeadline && (() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const expiryDate = new Date(job.applicationDeadline);
                expiryDate.setHours(0, 0, 0, 0);
                const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                const isExpiringSoon = daysUntilExpiry <= 7 && daysUntilExpiry >= 0;
                
                return (
                  <span className={`flex items-center gap-1.5 ${isExpiringSoon ? 'text-amber-600' : 'text-gray-500'}`}>
                    <Clock size={14} className={isExpiringSoon ? 'text-amber-500' : 'text-gray-400'} />
                    <span>
                      {isExpiringSoon ? (
                        <>
                          Expires: <span className="font-semibold text-amber-600">{new Date(job.applicationDeadline).toLocaleDateString()}</span>
                          <span className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                            {daysUntilExpiry === 0 ? 'Today' : daysUntilExpiry === 1 ? '1 day left' : `${daysUntilExpiry} days left`}
                          </span>
                        </>
                      ) : (
                        <>
                          Expires: <span className="font-medium text-gray-700">{new Date(job.applicationDeadline).toLocaleDateString()}</span>
                        </>
                      )}
                    </span>
                  </span>
                );
              })()}
            </div>
          </div>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className="px-4 py-2 cursor-pointer bg-[#02665e]/5 hover:bg-[#02665e]/10 text-[#02665e] font-semibold rounded-lg flex items-center gap-2 transition-all duration-200 group/btn border border-solid border-[#02665e]/20 hover:border-[#02665e]/40"
          >
            <span>View Details</span>
            <ChevronRight size={16} className="group-hover/btn:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}

function JobDetailModal({ job, onClose, onApply }: { job: Job; onClose: () => void; onApply: () => void }) {
  const formatSalary = (salary?: Job["salary"]) => {
    if (!salary || (!salary.min && !salary.max)) return "Competitive";
    const currency = salary.currency || "TZS";
    const period = salary.period === "YEARLY" ? "year" : "month";
    if (salary.min && salary.max) {
      return `${(salary.min / 1000).toFixed(0)}K - ${(salary.max / 1000).toFixed(0)}K ${currency}/${period}`;
    }
    return `${((salary.min || salary.max || 0) / 1000).toFixed(0)}K ${currency}/${period}`;
  };

  const getTypeColor = (type: JobType) => {
    switch (type) {
      case "FULL_TIME": return "bg-green-50 text-green-700 border-green-200";
      case "PART_TIME": return "bg-blue-50 text-blue-700 border-blue-200";
      case "CONTRACT": return "bg-purple-50 text-purple-700 border-purple-200";
      case "INTERNSHIP": return "bg-yellow-50 text-yellow-700 border-yellow-200";
      case "FREELANCE": return "bg-orange-50 text-orange-700 border-orange-200";
      case "PARTNERSHIP": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "AGENCY_AGREEMENT": return "bg-cyan-50 text-cyan-700 border-cyan-200";
      case "RESELLER": return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "AFFILIATE": return "bg-teal-50 text-teal-700 border-teal-200";
      case "WHITE_LABEL": return "bg-slate-100 text-slate-700 border-slate-200";
      default: return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  const getLocationIcon = (location: JobLocation) => {
    switch (location) {
      case "REMOTE": return <Globe size={16} className="flex-shrink-0 text-blue-600" />;
      case "ONSITE": return <Building2 size={16} className="flex-shrink-0 text-gray-700" />;
      case "HYBRID": return <RefreshCw size={16} className="flex-shrink-0 text-purple-600" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-0 border-b border-solid border-gray-200/60 p-6 sm:p-8 flex items-start justify-between z-10">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2 leading-tight">{job.title}</h2>
            <p className="text-base text-gray-500 font-medium">{job.department}</p>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-solid border-gray-200 bg-white hover:bg-gray-50 transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        <div className="p-6 sm:p-8 space-y-8">
          {/* Badges Section */}
          <div className="flex flex-wrap gap-3">
            <span className={`px-4 py-2.5 rounded-lg text-sm font-semibold border border-solid ${getTypeColor(job.type)} shadow-sm`}>
              {job.type.replace(/_/g, " ")}
            </span>
            <span className="px-4 py-2.5 rounded-lg text-sm font-medium bg-gray-50 text-gray-700 border border-solid border-gray-200 flex items-center gap-2 shadow-sm">
              {getLocationIcon(job.location)}
              <span className="capitalize">{job.location.toLowerCase()}</span>
              {job.locationDetail && (
                <>
                  <span className="text-gray-400">•</span>
                  <span>{job.locationDetail}</span>
                </>
              )}
            </span>
            <span className="px-4 py-2.5 rounded-lg text-sm font-medium bg-purple-50 text-purple-700 border border-solid border-purple-200 shadow-sm">
              {job.experienceLevel} Level
            </span>
            {job.salary && (
              <span className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-amber-50 text-amber-700 border border-solid border-amber-200 flex items-center gap-2 shadow-sm">
                <DollarSign size={16} className="text-amber-600" />
                {formatSalary(job.salary)}
              </span>
            )}
          </div>

          {/* Job Description */}
          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <Briefcase size={20} className="text-[#02665e]" />
              Job Description
            </h3>
            <p className="text-gray-700 leading-relaxed text-base">{job.description}</p>
          </div>

          {/* Key Responsibilities */}
          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-4">Key Responsibilities</h3>
            <ul className="space-y-3">
              {job.responsibilities.map((resp, idx) => (
                <li key={idx} className="flex items-start gap-3 text-gray-700 group">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="w-6 h-6 rounded-full bg-[#02665e]/10 flex items-center justify-center group-hover:bg-[#02665e]/20 transition-colors">
                      <ChevronRight className="text-[#02665e]" size={14} />
                    </div>
                  </div>
                  <span className="flex-1 pt-0.5">{resp}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Requirements */}
          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-4">Requirements</h3>
            <ul className="space-y-3">
              {job.requirements.map((req, idx) => (
                <li key={idx} className="flex items-start gap-3 text-gray-700 group">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="w-6 h-6 rounded-full bg-[#02665e]/10 flex items-center justify-center group-hover:bg-[#02665e]/20 transition-colors">
                      <ChevronRight className="text-[#02665e]" size={14} />
                    </div>
                  </div>
                  <span className="flex-1 pt-0.5">{req}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Benefits & Perks */}
          {job.benefits.length > 0 && (
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">Benefits & Perks</h3>
              <ul className="space-y-3">
                {job.benefits.map((benefit, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-gray-700 group">
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center group-hover:bg-green-200 transition-colors">
                        <CheckCircle2 className="text-green-600" size={16} />
                      </div>
                    </div>
                    <span className="flex-1 pt-0.5">{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-6 border-0 border-t border-solid border-gray-200">
            <div className="text-sm text-gray-600 space-y-1">
              <p className="flex items-center gap-2">
                <Calendar size={16} className="text-gray-400" />
                <span>Posted: <span className="font-medium text-gray-700">{new Date(job.postedDate).toLocaleDateString()}</span></span>
              </p>
              {job.applicationDeadline && (
                <p className="flex items-center gap-2">
                  <Clock size={16} className="text-gray-400" />
                  <span>Deadline: <span className="font-medium text-gray-700">{new Date(job.applicationDeadline).toLocaleDateString()}</span></span>
                </p>
              )}
            </div>
            <button
              onClick={onApply}
              className="px-8 py-3 cursor-pointer border-0 bg-gradient-to-r from-[#02665e] to-[#038a7c] text-white rounded-lg font-semibold hover:from-[#024d47] hover:to-[#02665e] transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 w-full sm:w-auto"
            >
              Apply Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CareersPage() {
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<"ADMIN" | "OWNER" | "DRIVER" | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPublicContext, setIsPublicContext] = useState<boolean | null>(null);
  const [isAgentContext, setIsAgentContext] = useState<boolean | null>(null);
  
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  
  // Fetch jobs from API
  useEffect(() => {
    const fetchJobs = async () => {
      setJobsLoading(true);
      try {
        const apiBase = typeof window === 'undefined'
          ? (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000")
          : '';
        const url = `${apiBase.replace(/\/$/, '')}/api/public/careers?page=1&pageSize=100`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          const fetchedJobs: Job[] = (data.jobs || []).map((job: any) => ({
            id: String(job.id),
            title: job.title,
            department: job.department,
            category: job.category as JobCategory,
            type: job.type as JobType,
            location: job.location as JobLocation,
            locationDetail: job.locationDetail || undefined,
            salary: job.salary || undefined,
            description: job.description,
            requirements: Array.isArray(job.requirements) ? job.requirements : [],
            responsibilities: Array.isArray(job.responsibilities) ? job.responsibilities : [],
            benefits: Array.isArray(job.benefits) ? job.benefits : [],
            postedDate: job.postedDate,
            applicationDeadline: job.applicationDeadline || undefined,
            experienceLevel: job.experienceLevel as "ENTRY" | "MID" | "SENIOR" | "LEAD",
            featured: Boolean(job.featured) || false,
            isTravelAgentPosition: Boolean(job.isTravelAgentPosition),
          }));
          setJobs(fetchedJobs);
        }
      } catch (error) {
        console.error('Error fetching jobs:', error);
        setJobs([]);
      } finally {
        setJobsLoading(false);
      }
    };
    
    fetchJobs();
  }, []);
  
  // Separate active and expired jobs - memoized to prevent infinite loops
  const activeJobs = useMemo(() => {
    return jobs.filter(job => {
      if (!job.applicationDeadline) return true; // Jobs without deadline are considered active
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const deadline = new Date(job.applicationDeadline);
      deadline.setHours(0, 0, 0, 0);
      return deadline >= today;
    });
  }, [jobs]);
  
  const expiredJobs = useMemo(() => {
    return jobs.filter(job => {
      if (!job.applicationDeadline) return false; // Jobs without deadline are not expired
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const deadline = new Date(job.applicationDeadline);
      deadline.setHours(0, 0, 0, 0);
      return deadline < today;
    });
  }, [jobs]);
  
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<JobCategory | "ALL">("ALL");
  const [selectedType, setSelectedType] = useState<JobType | "ALL">("ALL");
  const [selectedLocation, setSelectedLocation] = useState<JobLocation | "ALL">("ALL");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showApplicationForm, setShowApplicationForm] = useState(false);
  
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Context detection logic (same as other public pages)
    let navigationContext: 'public' | 'owner' | 'driver' | 'admin' | 'agent' | null = null;
    if (typeof window !== 'undefined') {
      const queryCtx = new URLSearchParams(window.location.search).get('ctx')?.toLowerCase();
      if (queryCtx === 'agent') {
        navigationContext = 'agent';
        sessionStorage.setItem('navigationContext', 'agent');
      }

      if (!navigationContext) {
      navigationContext = sessionStorage.getItem('navigationContext') as 'public' | 'owner' | 'driver' | 'admin' | 'agent' | null;
      }

      if (!navigationContext) {
        const ref = (document.referrer || '').toLowerCase();
        if (ref.includes('/account/agent')) {
          navigationContext = 'agent';
          sessionStorage.setItem('navigationContext', 'agent');
        }
      }
    }

    if (navigationContext) {
      if (navigationContext === 'public') {
        setIsAgentContext(false);
        setIsPublicContext(true);
        setUserRole(null);
        setIsLoading(false);
        return;
      } else if (navigationContext === 'agent') {
        setIsAgentContext(true);
        setIsPublicContext(false);
        setUserRole(null);
        setIsLoading(false);
        return;
      } else {
        setIsAgentContext(false);
        setIsPublicContext(false);
        setUserRole(navigationContext.toUpperCase() as "ADMIN" | "OWNER" | "DRIVER");
        setIsLoading(false);
        return;
      }
    }

    let isFromPublicRoute = false;
    if (typeof document !== 'undefined') {
      const referrer = document.referrer;
      const origin = window.location.origin;
      isFromPublicRoute = Boolean(referrer && (
        referrer.includes('/public') || 
        referrer === origin || 
        referrer === origin + '/' ||
        (!referrer.includes('/owner') && !referrer.includes('/driver') && !referrer.includes('/admin') && referrer.startsWith(origin))
      ));
    }

    if (isFromPublicRoute) {
      setIsAgentContext(false);
      setIsPublicContext(true);
      setUserRole(null);
      setIsLoading(false);
      return;
    }

    const role = getCookie('role') as "ADMIN" | "OWNER" | "DRIVER" | null;
    if (role) {
      setIsAgentContext(false);
      setIsPublicContext(false);
      setUserRole(role);
      setIsLoading(false);
      return;
    }
    
    if (pathname?.includes('/driver')) {
      setIsAgentContext(false);
      setIsPublicContext(false);
      setUserRole('DRIVER');
    } else if (pathname?.includes('/owner')) {
      setIsAgentContext(false);
      setIsPublicContext(false);
      setUserRole('OWNER');
    } else if (pathname?.includes('/admin')) {
      setIsAgentContext(false);
      setIsPublicContext(false);
      setUserRole('ADMIN');
    } else {
      setIsAgentContext(false);
      setIsPublicContext(true);
      setUserRole(null);
    }
    
    setIsLoading(false);
  }, [pathname]);

  // Filter jobs based on search and filters (only active jobs)
  useEffect(() => {
    if (jobsLoading) {
      setFilteredJobs([]);
      return;
    }
    
    let filtered = activeJobs;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        job =>
          job.title.toLowerCase().includes(query) ||
          job.department.toLowerCase().includes(query) ||
          job.description.toLowerCase().includes(query) ||
          job.locationDetail?.toLowerCase().includes(query)
      );
    }

    if (selectedCategory !== "ALL") {
      filtered = filtered.filter(job => job.category === selectedCategory);
    }

    if (selectedType !== "ALL") {
      filtered = filtered.filter(job => job.type === selectedType);
    }

    if (selectedLocation !== "ALL") {
      filtered = filtered.filter(job => job.location === selectedLocation);
    }

    setFilteredJobs(filtered);
  }, [jobsLoading, searchQuery, selectedCategory, selectedType, selectedLocation, activeJobs]);

  

  const shouldUsePublicLayout = !isAgentContext && (isPublicContext === true || (isPublicContext === null && userRole === null));
  const isAuthenticated = !shouldUsePublicLayout && userRole !== null;
  const isDriver = userRole === "DRIVER";
  const isOwner = userRole === "OWNER";

  const categories: Array<{ value: JobCategory | "ALL"; label: string }> = [
    { value: "ALL", label: "All Categories" },
    { value: "ENGINEERING", label: "Engineering" },
    { value: "DESIGN", label: "Design" },
    { value: "MARKETING", label: "Marketing" },
    { value: "SALES", label: "Sales" },
    { value: "OPERATIONS", label: "Operations" },
    { value: "SUPPORT", label: "Support" },
    { value: "MANAGEMENT", label: "Management" },
    { value: "OTHER", label: "Other" },
  ];

  const jobTypes: Array<{ value: JobType | "ALL"; label: string }> = [
    { value: "ALL", label: "All Types" },
    { value: "FULL_TIME", label: "Full Time" },
    { value: "PART_TIME", label: "Part Time" },
    { value: "CONTRACT", label: "Contract" },
    { value: "INTERNSHIP", label: "Internship" },
    { value: "FREELANCE", label: "Freelance" },
    { value: "PARTNERSHIP", label: "Partnership" },
    { value: "AGENCY_AGREEMENT", label: "Agency Agreement" },
    { value: "RESELLER", label: "Reseller" },
    { value: "AFFILIATE", label: "Affiliate" },
    { value: "WHITE_LABEL", label: "White Label" },
  ];

  const locations: Array<{ value: JobLocation | "ALL"; label: string }> = [
    { value: "ALL", label: "All Locations" },
    { value: "REMOTE", label: "Remote" },
    { value: "HYBRID", label: "Hybrid" },
    { value: "ONSITE", label: "On-site" },
  ];

  if (isLoading || isPublicContext === null || isAgentContext === null) {
    // The page's own shape in still blocks, so nothing jumps when the real content arrives
    return (
      <main className="min-h-screen bg-white text-slate-900" aria-busy="true">
        <span role="status" className="sr-only">Loading careers</span>
        <div className="public-container pt-6">
          <div className="h-64 w-full animate-pulse rounded-2xl bg-slate-100 md:h-80" />
          <div className="mx-auto mt-8 grid max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      {isAgentContext ? (
        <AgentPortalHeader />
      ) : shouldUsePublicLayout ? (
        <PublicHeader />
      ) : isAuthenticated ? (
        isDriver ? (
          <DriverSiteHeader />
        ) : isOwner ? (
          <OwnerSiteHeader />
        ) : (
          <SiteHeader role="ADMIN" />
        )
      ) : (
        <PublicHeader />
      )}
      
      <main className="min-h-screen bg-white text-slate-900 overflow-x-hidden">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />
        
        <style>{"#careers-page, #careers-page * { box-sizing: border-box; }"}</style>
        <div id="careers-page">
        {/* Careers hero: the photo with the heading and a direct way to the roles */}
        <section ref={heroRef} className="relative w-full pt-4">
          <div className="public-container">
            <div className="relative h-64 w-full overflow-hidden rounded-2xl md:h-80 lg:h-96">
              <Image
                src="/assets/nolsaf_careers.jpg"
                alt="The NoLSAF team at work"
                fill
                className="object-cover"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-black/20" />
              <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
                <p className="m-0 text-[12.5px] font-bold tracking-[0.06em] text-emerald-200">Careers at NoLSAF</p>
                <h1 className="m-0 mt-2 text-3xl font-extrabold tracking-tight text-white drop-shadow-[0_10px_30px_rgba(0,0,0,0.55)] md:text-4xl lg:text-5xl">
                  Why Work at NoLSAF?
                </h1>
                <a
                  href="#open-positions"
                  className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold text-[#02665e] no-underline shadow-lg transition-transform hover:-translate-y-0.5"
                >
                  {jobsLoading ? "See open positions" : `See ${activeJobs.length} open position${activeJobs.length === 1 ? "" : "s"}`}
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Company culture: its own band under the photo, never tucked behind it */}
        <section className="pb-12 pt-10 md:pt-12">
          <div className="public-container">
            <div className="max-w-6xl mx-auto">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  {
                    icon: <Heart size={32} />,
                    iconColor: "text-red-500",
                    title: "Mission-Driven",
                    description: "We're building something meaningful that connects travelers with quality stays and safe transport across Africa."
                  },
                  {
                    icon: <Users size={32} />,
                    iconColor: "text-blue-500",
                    title: "Inclusive Culture",
                    description: "We celebrate diversity and create an environment where everyone can thrive and bring their authentic selves to work."
                  },
                  {
                    icon: <TrendingUp size={32} />,
                    iconColor: "text-green-500",
                    title: "Career Growth",
                    description: "We invest in our team's development with training, mentorship, and opportunities to take on new challenges."
                  },
                  {
                    icon: <Globe size={32} />,
                    iconColor: "text-purple-500",
                    title: "Flexible Work",
                    description: "Work from anywhere in Africa. We offer remote, hybrid, and on-site options to fit your lifestyle."
                  },
                  {
                    icon: <DollarSign size={32} />,
                    iconColor: "text-amber-500",
                    title: "Competitive Benefits",
                    description: "We offer competitive salaries, health insurance, and performance bonuses to reward your contributions."
                  },
                  {
                    icon: <Building2 size={32} />,
                    iconColor: "text-[#02665e]",
                    title: "Innovation",
                    description: "Work with cutting-edge technology and help shape the future of travel in Africa."
                  }
                ].map((benefit, idx) => (
                  <div
                    key={idx}
                    className="flex gap-4 rounded-2xl border border-solid border-slate-200 bg-white p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-18px_rgba(15,23,42,0.35)]"
                  >
                    <span className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200 [&>svg]:h-5 [&>svg]:w-5 ${benefit.iconColor}`}>{benefit.icon}</span>
                    <div className="min-w-0">
                      <h3 className="m-0 text-[16.5px] font-bold text-gray-900">{benefit.title}</h3>
                      <p className="m-0 mt-1 text-[14px] leading-6 text-gray-600">{benefit.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Job Listings Section */}
        <section id="open-positions" className="scroll-mt-24 border-0 border-t border-solid border-slate-100 bg-white pb-16 pt-12">
          <div className="public-container">
            <div className="w-full min-w-0 max-w-7xl mx-auto">
              <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="m-0 text-3xl font-bold text-gray-900 md:text-4xl">Open Positions</h2>
                  <p className="m-0 mt-2 text-gray-600">Find the perfect role for you</p>
                </div>
                {!jobsLoading ? (
                  <span className="rounded-full bg-[#02665e]/10 px-3 py-1 text-[13px] font-bold text-[#02665e]">
                    {activeJobs.length} open role{activeJobs.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>

              {/* Search and Filters */}
              <div className="mb-8 min-w-0 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-slate-50/70 p-4 sm:p-5">
                <div className="mb-4">
                  <div className="relative w-full min-w-0 max-w-full">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input
                      type="text"
                      placeholder="Search jobs by title, department, or location..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full min-w-0 max-w-full box-border pl-12 pr-4 py-3 border border-solid border-gray-300 bg-white rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Filter size={16} className="inline mr-1" />
                      Category
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value as JobCategory | "ALL")}
                      className="w-full px-4 py-2 border border-solid border-gray-300 bg-white rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent"
                    >
                      {categories.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Job Type
                    </label>
                    <select
                      value={selectedType}
                      onChange={(e) => setSelectedType(e.target.value as JobType | "ALL")}
                      className="w-full px-4 py-2 border border-solid border-gray-300 bg-white rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent"
                    >
                      {jobTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Location
                    </label>
                    <select
                      value={selectedLocation}
                      onChange={(e) => setSelectedLocation(e.target.value as JobLocation | "ALL")}
                      className="w-full px-4 py-2 border border-solid border-gray-300 bg-white rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent"
                    >
                      {locations.map((loc) => (
                        <option key={loc.value} value={loc.value}>
                          {loc.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {(searchQuery || selectedCategory !== "ALL" || selectedType !== "ALL" || selectedLocation !== "ALL") && (
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setSelectedCategory("ALL");
                        setSelectedType("ALL");
                        setSelectedLocation("ALL");
                      }}
                      className="cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-[#02665e] hover:underline"
                    >
                      Clear all filters
                    </button>
                    <span className="text-gray-400">•</span>
                    <span className="text-sm text-gray-600">
                      {filteredJobs.length} {filteredJobs.length === 1 ? "job" : "jobs"} found
                    </span>
                  </div>
                )}
              </div>

              {/* Job Cards */}
              {jobsLoading ? (
                // Skeleton cards in the same grid as real job cards
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-busy="true">
                  <span role="status" className="sr-only">Loading open positions</span>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-2xl border border-solid border-slate-200 bg-white p-6">
                      <div className="h-5 w-2/3 animate-pulse rounded-md bg-slate-100" />
                      <div className="mt-2 h-3.5 w-1/3 animate-pulse rounded-md bg-slate-100" />
                      <div className="mt-5 flex gap-2">
                        <div className="h-6 w-20 animate-pulse rounded-lg bg-slate-100" />
                        <div className="h-6 w-16 animate-pulse rounded-lg bg-slate-100" />
                        <div className="h-6 w-14 animate-pulse rounded-lg bg-slate-100" />
                      </div>
                      <div className="mt-5 h-3.5 w-full animate-pulse rounded-md bg-slate-100" />
                      <div className="mt-2 h-3.5 w-4/5 animate-pulse rounded-md bg-slate-100" />
                      <div className="mt-6 flex items-center justify-between border-0 border-t border-solid border-slate-100 pt-4">
                        <div className="h-3.5 w-28 animate-pulse rounded-md bg-slate-100" />
                        <div className="h-9 w-28 animate-pulse rounded-lg bg-slate-100" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredJobs.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {filteredJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      onClick={() => setSelectedJob(job)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <Briefcase className="mx-auto text-gray-400 mb-4" size={64} />
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">No jobs found</h3>
                  <p className="text-gray-600 mb-6">
                    {searchQuery || selectedCategory !== "ALL" || selectedType !== "ALL" || selectedLocation !== "ALL"
                      ? "Try adjusting your search or filters to see more results."
                      : "No job openings available at the moment. Check back soon!"}
                  </p>
                  {(searchQuery || selectedCategory !== "ALL" || selectedType !== "ALL" || selectedLocation !== "ALL") && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setSelectedCategory("ALL");
                        setSelectedType("ALL");
                        setSelectedLocation("ALL");
                      }}
                      className="px-6 py-3 cursor-pointer border-0 bg-[#02665e] text-white rounded-lg font-semibold hover:bg-[#024d47] transition-colors"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Job History Section */}
        <section className="py-16 bg-gray-50">
          <div className="public-container">
            <div className="max-w-7xl mx-auto">
              <div className="mb-8 text-center">
                <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Job Announcement History</h2>
                <p className="text-gray-600 text-lg">A timeline of our recent job postings and opportunities</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {expiredJobs.length > 0 ? (
                  expiredJobs
                    .map(job => ({
                      date: job.postedDate,
                      expiryDate: job.applicationDeadline || undefined,
                      title: job.title,
                      department: job.department,
                      status: "Expired",
                      description: job.description || `This position expired on ${job.applicationDeadline ? new Date(job.applicationDeadline).toLocaleDateString() : 'N/A'}.`
                    }))
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map((item, idx) => (
                      <div key={idx} className="flex h-full flex-col rounded-2xl border border-solid border-slate-200 bg-white p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="m-0 text-[16.5px] font-bold leading-snug text-gray-900">{item.title}</h3>
                            <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-[#02665e]/[0.07] px-2 py-0.5 text-[12px] font-semibold text-[#02665e]">
                              <Briefcase size={12} aria-hidden />
                              {item.department}
                            </span>
                          </div>
                          <span className="flex-shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">Closed</span>
                        </div>
                        <p className="m-0 mt-3 line-clamp-3 flex-1 text-[13.5px] leading-6 text-gray-600">{item.description}</p>
                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-0 border-t border-solid border-slate-100 pt-3 text-[12.5px] text-slate-500">
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar size={13} className="text-slate-400" aria-hidden />
                            Posted {new Date(item.date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                          </span>
                          {item.expiryDate ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Clock size={13} className="text-slate-400" aria-hidden />
                              Closed {new Date(item.expiryDate).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))
                ) : (
                  <div className="col-span-full text-center py-12">
                    <Briefcase className="mx-auto mb-4 text-gray-400" size={48} />
                    <p className="text-gray-600">No job history available yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="relative w-full overflow-hidden py-16">
          <div className="public-container">
            <div className="relative w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[#02665e] to-[#024d47] text-white">
              <div className="max-w-3xl mx-auto text-center p-8 md:p-12">
                <h2 className="m-0 text-3xl font-bold md:text-4xl">
                  Don&apos;t see a role that fits?
                </h2>
                <p className="m-0 mb-7 mt-3 text-lg text-white/85">
                  We're always looking for talented people. Send us your resume and we'll keep you in mind for future opportunities.
                </p>
                <a
                  href="mailto:careers@nolsaf.com"
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-7 font-semibold text-[#02665e] no-underline shadow-md transition-transform hover:-translate-y-0.5"
                >
                  Send Your Resume
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </a>
              </div>
            </div>
          </div>
        </section>
        </div>
      </main>
      
      {isAgentContext ? (
        <AgentFooter withRail={false} />
      ) : shouldUsePublicLayout ? (
        <PublicFooter withRail={false} />
      ) : isAuthenticated ? (
        <SiteFooter withRail={false} topSeparator={true} />
      ) : (
        <PublicFooter withRail={false} />
      )}

      {/* Job Detail Modal */}
      {selectedJob && !showApplicationForm && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onApply={() => setShowApplicationForm(true)}
        />
      )}

      {/* Application Form Modal */}
      {selectedJob && showApplicationForm && (
        <CareersApplicationForm
          job={selectedJob}
          onCloseAction={() => {
            setShowApplicationForm(false);
            setSelectedJob(null);
          }}
          onSuccessAction={() => {
            setShowApplicationForm(false);
            setSelectedJob(null);
          }}
        />
      )}
    </>
  );
}
