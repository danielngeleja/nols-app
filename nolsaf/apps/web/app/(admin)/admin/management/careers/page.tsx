"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Plus, Edit, Trash2, Eye, X, Calendar, MapPin, Clock, CheckCircle2, AlertCircle, FileText, Users, Mail, Phone, ExternalLink, Download, CheckSquare, Square, Languages, Building2, Handshake, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import PDFViewer from "@/components/PDFViewer";
import DatePicker from "@/components/ui/DatePicker";
import { normalizePartnershipProfile } from "@/components/careers/partnershipProfile";
import { useSearchParams } from "next/navigation";

type Job = {
  id: number;
  title: string;
  category: string;
  type: string;
  location: string;
  locationDetail?: string | null;
  department: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  experienceLevel: string;
  salary?: {
    min?: number;
    max?: number;
    currency?: string;
    period?: "MONTHLY" | "YEARLY";
  } | null;
  postedDate: string;
  applicationDeadline?: string | null;
  featured: boolean;
  status: string;
  isTravelAgentPosition?: boolean;
  requiredEducationLevel?: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobFormData = {
  title: string;
  category: string;
  type: string;
  location: string;
  locationDetail: string;
  department: string;
  description: string;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  experienceLevel: string;
  requiredEducationLevel: string;
  applicationDeadline: string;
  featured: boolean;
  status: string;
  isTravelAgentPosition: boolean;
};

type ContractWorkflowStatus = "PENDING_NOLSAF_SIGNATURE" | "PENDING_AGENT_SIGNATURE" | "EXECUTED";

type ContractWorkflow = {
  status: ContractWorkflowStatus;
  contractId: string;
  version: string;
  createdAt: string;
  preparedAt?: string;
  sentAt?: string;
  nolsafSignedAt?: string;
  nolsafSignatoryName?: string;
  nolsafSignatoryTitle?: string;
  agentSignedAt?: string;
  agentSignerName?: string;
};

type AuditTimelineItem = {
  id: number;
  action: string;
  createdAt: string;
  actorId?: number | null;
  actorRole?: string | null;
  actorName?: string | null;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
};

const CATEGORIES = ["ENGINEERING", "DESIGN", "MARKETING", "SALES", "OPERATIONS", "SUPPORT", "MANAGEMENT", "OTHER"];
const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "FREELANCE"];
const PARTNERSHIP_TYPES = ["PARTNERSHIP", "AGENCY_AGREEMENT", "RESELLER", "AFFILIATE", "WHITE_LABEL"];
const TYPES = [...EMPLOYMENT_TYPES, ...PARTNERSHIP_TYPES];
const LOCATIONS = ["REMOTE", "ONSITE", "HYBRID"];
const EXPERIENCE_LEVELS = ["ENTRY", "MID", "SENIOR", "LEAD"];

export default function CareersManagement() {
  const searchParams = useSearchParams();
  const requestedApplicationId = Number(searchParams?.get("applicationId") || 0);
  const apiBase = typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000")
    : '';
  
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [viewingJob, setViewingJob] = useState<Job | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deadlinePickerOpen, setDeadlinePickerOpen] = useState(false);
  
  // Applications state
  const [activeTab, setActiveTab] = useState<'jobs' | 'applications'>('jobs');
  const [applications, setApplications] = useState<any[]>([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [viewingApplication, setViewingApplication] = useState<any | null>(null);
  const [contractWorkflow, setContractWorkflow] = useState<ContractWorkflow | null>(null);
  const [contractWorkflowLoading, setContractWorkflowLoading] = useState(false);
  const [contractActionLoading, setContractActionLoading] = useState<"prepare" | "sign" | null>(null);
  const [auditTimeline, setAuditTimeline] = useState<AuditTimelineItem[]>([]);
  const [auditTimelineLoading, setAuditTimelineLoading] = useState(false);
  const [applicationStatusFilter, setApplicationStatusFilter] = useState<string>('ALL');
  const [applicationJobFilter, setApplicationJobFilter] = useState<string>('ALL');
  const applicationSearch = '';
  const [selectedApplications, setSelectedApplications] = useState<number[]>([]);
  const [applicationsPage, setApplicationsPage] = useState(1);
  const [applicationSortBy, setApplicationSortBy] = useState<"companyContact" | "partnershipForm" | "status" | "submitted">("submitted");
  const [applicationSortDir, setApplicationSortDir] = useState<"asc" | "desc">("desc");
  
  const [, setStatistics] = useState<any>(null);
  const [, setStatisticsLoading] = useState(false);
  const [resumeViewUrl, setResumeViewUrl] = useState<string | null>(null);
  const [viewingResume, setViewingResume] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const applicationsPageSize = 10;

  useEffect(() => {
    const tab = String(searchParams?.get("tab") || "").toLowerCase();
    if (tab === "applications" || (Number.isInteger(requestedApplicationId) && requestedApplicationId > 0)) setActiveTab("applications");
    if (tab === "jobs") setActiveTab("jobs");
  }, [searchParams, requestedApplicationId]);

  const [formData, setFormData] = useState<JobFormData>({
    title: "",
    category: "ENGINEERING",
    type: "FULL_TIME",
    location: "REMOTE",
    locationDetail: "",
    department: "",
    description: "",
    responsibilities: [""],
    requirements: [""],
    benefits: [""],
    experienceLevel: "ENTRY",
    requiredEducationLevel: "",
    applicationDeadline: "",
    featured: false,
    status: "ACTIVE",
    isTravelAgentPosition: false
  });

  const loadApplications = async () => {
    setApplicationsLoading(true);
    setError(null);
    try {
      let url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications?page=1&pageSize=100`;
      if (applicationStatusFilter !== 'ALL') {
        url += `&status=${applicationStatusFilter}`;
      }
      if (applicationJobFilter !== 'ALL' && applicationJobFilter) {
        // Validate that jobId is a valid number
        const jobIdNum = parseInt(applicationJobFilter, 10);
        if (!isNaN(jobIdNum)) {
          url += `&jobId=${jobIdNum}`;
        }
      }
      if (applicationSearch.trim()) {
        url += `&search=${encodeURIComponent(applicationSearch.trim())}`;
      }
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to load applications: ${r.status}`);
      }
      const data = await r.json();
      setApplications(data.applications || []);
    } catch (e: any) {
      console.error('Error loading applications:', e);
      setError(e.message || 'Failed to load applications');
    } finally {
      setApplicationsLoading(false);
    }
  };

  useEffect(() => {
    if (!Number.isInteger(requestedApplicationId) || requestedApplicationId <= 0) return;

    const controller = new AbortController();
    const loadRequestedApplication = async () => {
      try {
        const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${requestedApplicationId}`;
        const response = await fetch(url, { credentials: 'include', signal: controller.signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || `Failed to load application: ${response.status}`);
        }
        setViewingApplication(data);
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
        setError(error?.message || 'Failed to load application');
      }
    };

    void loadRequestedApplication();
    return () => controller.abort();
  }, [apiBase, requestedApplicationId]);

  const loadContractWorkflow = useCallback(async (applicationId: number) => {
    setContractWorkflowLoading(true);
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${applicationId}/contract/workflow`;
      const r = await fetch(url, { credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setContractWorkflow(null);
        return;
      }
      setContractWorkflow((data?.workflow as ContractWorkflow) || null);
    } catch {
      setContractWorkflow(null);
    } finally {
      setContractWorkflowLoading(false);
    }
  }, [apiBase]);

  const loadAuditTimeline = useCallback(async (applicationId: number) => {
    setAuditTimelineLoading(true);
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${applicationId}/audit-timeline`;
      const r = await fetch(url, { credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAuditTimeline([]);
        return;
      }
      setAuditTimeline(Array.isArray(data?.items) ? (data.items as AuditTimelineItem[]) : []);
    } catch {
      setAuditTimeline([]);
    } finally {
      setAuditTimelineLoading(false);
    }
  }, [apiBase]);

  const handlePrepareContractWorkflow = async () => {
    if (!viewingApplication?.id || contractActionLoading) return;
    setContractActionLoading('prepare');
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${viewingApplication.id}/contract/prepare`;
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.message || data?.error || 'Failed to prepare contract workflow');
      }
      setContractWorkflow((data?.workflow as ContractWorkflow) || null);
      await loadAuditTimeline(viewingApplication.id);
      setSuccess('Contract workflow prepared for NoLSAF signature.');
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e?.message || 'Failed to prepare contract workflow');
      setTimeout(() => setError(null), 5000);
    } finally {
      setContractActionLoading(null);
    }
  };

  const handleAdminSignContract = async () => {
    if (!viewingApplication?.id || contractActionLoading) return;
    setContractActionLoading('sign');
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${viewingApplication.id}/contract/sign`;
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data?.message || data?.error || 'Failed to sign contract');
      }
      setContractWorkflow((data?.workflow as ContractWorkflow) || null);
      await loadAuditTimeline(viewingApplication.id);
      setSuccess('NoLSAF signature applied. Contract now awaits operator countersignature.');
      setTimeout(() => setSuccess(null), 5000);
    } catch (e: any) {
      setError(e?.message || 'Failed to sign contract');
      setTimeout(() => setError(null), 5000);
    } finally {
      setContractActionLoading(null);
    }
  };

  const loadStatistics = async () => {
    setStatisticsLoading(true);
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/stats`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to load statistics: ${r.status}`;
        
        // If it's a schema error, show a helpful message
        if (errorMessage.includes('Database schema not updated') || errorMessage.includes('prisma generate')) {
          console.error('Prisma schema needs to be regenerated. Please stop the dev server, run "npm run prisma:generate" from the root directory, then restart the server.');
        }
        
        throw new Error(errorMessage);
      }
      const data = await r.json();
      setStatistics(data);
    } catch (e: any) {
      console.error('Error loading statistics:', e);
      // Don't show error to user - statistics are optional
      // setError(e.message || 'Failed to load statistics');
    } finally {
      setStatisticsLoading(false);
    }
  };

  const toggleApplicationSelection = (id: number) => {
    setSelectedApplications(prev => 
      prev.includes(id) 
        ? prev.filter(appId => appId !== id)
        : [...prev, id]
    );
  };

  const sortedApplications = useMemo(() => {
    const rows = [...applications];
    const readValue = (app: any): string | number => {
      switch (applicationSortBy) {
        case "companyContact":
          return `${String(app.fullName || "").toLowerCase()} ${String(app.email || "").toLowerCase()} ${String(app.phone || "").toLowerCase()}`;
        case "partnershipForm":
          return `${String(app.job?.title || "").toLowerCase()} ${String(app.job?.department || "").toLowerCase()}`;
        case "status":
          return String(app.status || "").toLowerCase();
        case "submitted":
          return new Date(app.submittedAt || "").getTime() || 0;
        default:
          return "";
      }
    };

    rows.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return applicationSortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return applicationSortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [applications, applicationSortBy, applicationSortDir]);

  const totalApplicationPages = Math.max(1, Math.ceil(sortedApplications.length / applicationsPageSize));
  const safeApplicationsPage = Math.min(applicationsPage, totalApplicationPages);
  const applicationsStart = (safeApplicationsPage - 1) * applicationsPageSize;
  const applicationsEnd = applicationsStart + applicationsPageSize;
  const pagedApplications = sortedApplications.slice(applicationsStart, applicationsEnd);

  const allVisibleSelected = pagedApplications.length > 0 && pagedApplications.every((app) => selectedApplications.includes(app.id));

  const toggleSelectAll = () => {
    const visibleIds = pagedApplications.map((app) => app.id);
    if (visibleIds.length === 0) return;

    if (allVisibleSelected) {
      setSelectedApplications((prev) => prev.filter((id) => !visibleIds.includes(id)));
      return;
    }

    setSelectedApplications((prev) => Array.from(new Set([...prev, ...visibleIds])));
  };

  const handleApplicationSort = (field: "companyContact" | "partnershipForm" | "status" | "submitted") => {
    if (applicationSortBy === field) {
      setApplicationSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setApplicationSortBy(field);
    setApplicationSortDir(field === "submitted" ? "desc" : "asc");
  };

  const renderApplicationSortIcon = (field: "companyContact" | "partnershipForm" | "status" | "submitted") => {
    if (applicationSortBy !== field) return <ChevronsUpDown size={14} className="text-gray-400" />;
    return applicationSortDir === "asc"
      ? <ChevronUp size={14} className="text-[#02665e]" />
      : <ChevronDown size={14} className="text-[#02665e]" />;
  };

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers?page=1&pageSize=100`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error('Failed to fetch partnership forms');
      const data = await r.json();
      setJobs(data.jobs || []);
    } catch (e: any) {
      console.error('Error loading partnership forms:', e);
      setError(e.message || 'Failed to load partnership forms');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (activeTab === 'applications') {
      loadApplications();
      loadStatistics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, applicationStatusFilter, applicationJobFilter, applicationSearch]);

  useEffect(() => {
    setApplicationsPage(1);
  }, [applicationStatusFilter, applicationJobFilter, applicationSearch, applicationSortBy, applicationSortDir, applications.length]);

  useEffect(() => {
    if (!viewingApplication?.id) {
      setContractWorkflow(null);
      setAuditTimeline([]);
      return;
    }
    void loadContractWorkflow(viewingApplication.id);
    void loadAuditTimeline(viewingApplication.id);
  }, [viewingApplication?.id, loadContractWorkflow, loadAuditTimeline]);

  const resetForm = () => {
    setFormData({
      title: "",
      category: "ENGINEERING",
      type: "FULL_TIME",
      location: "REMOTE",
      locationDetail: "",
      department: "",
      description: "",
      responsibilities: [""],
      requirements: [""],
      benefits: [""],
      experienceLevel: "ENTRY",
      requiredEducationLevel: "",
      applicationDeadline: "",
      featured: false,
      status: "ACTIVE",
      isTravelAgentPosition: false
    });
    setEditingJob(null);
    setShowForm(false);
  };

  const handleEdit = (job: Job) => {
    setEditingJob(job);
    setFormData({
      title: job.title,
      category: job.category,
      type: job.type,
      location: job.location,
      locationDetail: job.locationDetail || "",
      department: job.department,
      description: job.description,
      responsibilities: job.responsibilities.length > 0 ? job.responsibilities : [""],
      requirements: job.requirements.length > 0 ? job.requirements : [""],
      benefits: job.benefits.length > 0 ? job.benefits : [""],
      experienceLevel: job.experienceLevel,
      requiredEducationLevel: job.requiredEducationLevel || "",
      applicationDeadline: job.applicationDeadline ? new Date(job.applicationDeadline).toISOString().split('T')[0] : "",
      featured: job.featured,
      status: job.status,
      isTravelAgentPosition: job.isTravelAgentPosition ?? false,
    });
    setShowForm(true);
  };

  const handleDelete = (id: number) => {
    setDeleteConfirmId(id);
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirmId) return;
    setIsDeleting(true);
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/${deleteConfirmId}`;
      const r = await fetch(url, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!r.ok) throw new Error('Failed to delete partnership form');
      setSuccess('Partnership form deleted successfully');
      loadJobs();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message || 'Failed to delete partnership form');
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsDeleting(false);
      setDeleteConfirmId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const finalTitle = formData.title;

      const payload = {
        title: finalTitle,
        category: formData.category,
        type: formData.type,
        location: formData.location,
        locationDetail: formData.locationDetail || null,
        department: formData.department,
        description: formData.description,
        responsibilities: formData.responsibilities.filter(r => r.trim()),
        requirements: formData.requirements.filter(r => r.trim()),
        benefits: formData.benefits.filter(b => b.trim()),
        experienceLevel: formData.experienceLevel,
        requiredEducationLevel: formData.requiredEducationLevel || null,
        salary: null,
        applicationDeadline: formData.applicationDeadline || null,
        featured: formData.featured,
        status: formData.status,
        isTravelAgentPosition: formData.isTravelAgentPosition
      };

      const url = editingJob
        ? `${apiBase.replace(/\/$/, '')}/api/admin/careers/${editingJob.id}`
        : `${apiBase.replace(/\/$/, '')}/api/admin/careers`;
      
      const method = editingJob ? 'PATCH' : 'POST';
      
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });

      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save partnership form');
      }

      setSuccess(editingJob ? 'Partnership form updated successfully' : 'Partnership form created successfully');
      resetForm();
      loadJobs();
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message || 'Failed to save partnership form');
      setTimeout(() => setError(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const addListItem = (field: 'responsibilities' | 'requirements' | 'benefits') => {
    setFormData(prev => ({
      ...prev,
      [field]: [...prev[field], ""]
    }));
  };

  const updateListItem = (field: 'responsibilities' | 'requirements' | 'benefits', index: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => i === index ? value : item)
    }));
  };

  const removeListItem = (field: 'responsibilities' | 'requirements' | 'benefits', index: number) => {
    setFormData(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index)
    }));
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const displayStatus = (status: string) => {
    if (status === "HIRED") return "APPROVED";
    if (status === "SHORTLISTED") return "QUALIFIED";
    return status;
  };

  const formatAuditAction = (action: string) => {
    const map: Record<string, string> = {
      JOB_APPLICATION_UPDATE: 'Application Updated',
      ADMIN_AGENT_CONTRACT_PREPARED: 'Contract Draft Prepared',
      ADMIN_AGENT_CONTRACT_SIGNED: 'NoLSAF Signed Contract',
      AGENT_CONTRACT_SIGNED: 'Operator Signed Contract',
      JOB_APPLICATION_DELETE: 'Application Deleted',
      JOB_APPLICATION_BULK_UPDATE: 'Bulk Application Update',
      JOB_APPLICATION_BULK_DELETE: 'Bulk Application Delete',
    };
    return map[action] || action.replace(/_/g, ' ');
  };

  const summarizeAuditEvent = (entry: AuditTimelineItem) => {
    const beforeStatus = typeof entry.before?.status === 'string' ? entry.before.status : null;
    const afterStatus = typeof entry.after?.status === 'string' ? entry.after.status : null;

    if (beforeStatus && afterStatus && beforeStatus !== afterStatus) {
      return `Status changed from ${displayStatus(beforeStatus)} to ${displayStatus(afterStatus)}`;
    }

    if (entry.action === 'ADMIN_AGENT_CONTRACT_PREPARED') {
      return 'Contract workflow initialized for legal review.';
    }

    if (entry.action === 'ADMIN_AGENT_CONTRACT_SIGNED') {
      return 'NoLSAF signature completed, waiting for operator countersignature.';
    }

    if (entry.action === 'AGENT_CONTRACT_SIGNED') {
      return 'Operator countersigned the contract.';
    }

    return 'Administrative record captured for legal traceability.';
  };

  const updateApplicationStatus = async (applicationId: number, status: string, notes?: string) => {
    // Prevent duplicate updates
    if (updatingStatus === applicationId) {
      return;
    }
    
    // Prevent setting the same status
    if (viewingApplication?.id === applicationId && viewingApplication?.status === status) {
      setError('This status is already set. Please select a different status.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setUpdatingStatus(applicationId);
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${applicationId}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status, adminNotes: notes })
      });
      if (!r.ok) throw new Error('Failed to update company application');
      const updated = await r.json();
      if (updated.emailWarning) {
        setSuccess(`Status updated. Note: ${updated.emailWarning}`);
      } else if (updated.emailSent) {
        setSuccess('Application status updated - email notification sent to company contact.');
      } else {
        setSuccess('Company application status updated successfully');
      }
      loadApplications();
      if (viewingApplication?.id === applicationId) {
        setViewingApplication(updated);
        await loadAuditTimeline(applicationId);
        if (String(updated?.status || "").toUpperCase() === "HIRED") {
          void loadContractWorkflow(applicationId);
        }
      }
      setTimeout(() => setSuccess(null), 5000);
    } catch (e: any) {
      setError(e.message || 'Failed to update company application');
      setTimeout(() => setError(null), 5000);
    } finally {
      setUpdatingStatus(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-100 text-yellow-800';
      case 'REVIEWING': return 'bg-blue-100 text-blue-800';
      case 'SHORTLISTED': return 'bg-green-100 text-green-800';
      case 'REJECTED': return 'bg-red-100 text-red-800';
      case 'HIRED': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const handleViewResume = async (applicationId: number) => {
    try {
      // Check if application has document data before attempting to fetch
      const application = applications.find(app => app.id === applicationId) || viewingApplication;
      if (application && !application.resumeStorageKey && !application.resumeUrl) {
        setError('Application document is not available. It may not have been uploaded successfully.');
        setTimeout(() => setError(null), 5000);
        return;
      }

      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${applicationId}/resume`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}));
        const errorMessage = errorData.error || `Failed to get resume URL: ${r.status}`;
        if (errorMessage.includes('not available') || errorMessage.includes('Resume not available')) {
          throw new Error('Application document is not available. It may not have been uploaded successfully or may have been deleted.');
        }
        throw new Error(errorMessage);
      }
      const data = await r.json();
      if (!data.url) {
        throw new Error('Application document URL not available');
      }
      setResumeViewUrl(data.url);
      setViewingResume(true);
    } catch (e: any) {
      console.error('Error loading application document:', e);
      setError(e.message || 'Failed to load application document');
      setTimeout(() => setError(null), 5000);
    }
  };

  if (viewingJob) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Partnership Form Details</h1>
            <button
              onClick={() => setViewingJob(null)}
              className="p-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-lg transition-all duration-200 text-gray-600 hover:text-gray-900 group"
              title="Close"
            >
              <X size={20} className="transition-transform duration-200 group-hover:rotate-90" />
            </button>
          </div>
          
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">{viewingJob.title}</h2>
              <p className="text-gray-600">{viewingJob.department}</p>
            </div>
            
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-lg text-sm">{viewingJob.category}</span>
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-lg text-sm">{viewingJob.type.replace('_', ' ')}</span>
              <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-lg text-sm">{viewingJob.location}</span>
              <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-lg text-sm">{viewingJob.experienceLevel}</span>
              {viewingJob.featured && (
                <span className="px-3 py-1 bg-[#02665e] text-white rounded-lg text-sm font-semibold">Featured</span>
              )}
              <span className={`px-3 py-1 rounded-lg text-sm font-semibold ${
                viewingJob.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                viewingJob.status === 'CLOSED' ? 'bg-gray-100 text-gray-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {displayStatus(viewingJob.status)}
              </span>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar size={16} />
                <span>Opened: {formatDate(viewingJob.postedDate)}</span>
              </div>
              {viewingJob.applicationDeadline && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Clock size={16} />
                  <span>Expires: {formatDate(viewingJob.applicationDeadline)}</span>
                </div>
              )}
              {viewingJob.locationDetail && (
                <div className="flex items-center gap-2 text-gray-600">
                  <MapPin size={16} />
                  <span>{viewingJob.locationDetail}</span>
                </div>
              )}
            </div>
            
            <div>
              <h3 className="font-bold text-gray-900 mb-2">Partnership Brief</h3>
              <p className="text-gray-700 whitespace-pre-wrap">{viewingJob.description}</p>
            </div>
            
            <div>
              <h3 className="font-bold text-gray-900 mb-2">Company Expectations</h3>
              <ul className="list-disc list-inside space-y-1 text-gray-700">
                {viewingJob.responsibilities.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            
            <div>
              <h3 className="font-bold text-gray-900 mb-2">Approval Requirements</h3>
              <ul className="list-disc list-inside space-y-1 text-gray-700">
                {viewingJob.requirements.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
            
            {viewingJob.benefits.length > 0 && (
              <div>
                <h3 className="font-bold text-gray-900 mb-2">Partnership Benefits</h3>
                <ul className="list-disc list-inside space-y-1 text-gray-700">
                  {viewingJob.benefits.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="group overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-6 shadow-sm">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#02665e] text-white shadow-lg shadow-emerald-900/10">
            <Handshake className="h-8 w-8" />
          </div>
          <h1 className="relative text-2xl sm:text-3xl font-semibold tracking-tight">
            <span className="text-gray-900 transition-colors duration-300 group-focus-within:text-transparent">
              Tour Partnerships Management
            </span>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#02665e] via-gray-900 to-[#02665e] bg-clip-text text-transparent opacity-0 transition-opacity duration-500 group-focus-within:opacity-100"
            >
              Tour Partnerships Management
            </span>
            <span
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-full mt-2 h-[2px] w-0 -translate-x-1/2 bg-gradient-to-r from-transparent via-[#02665e]/60 to-transparent transition-[width] duration-500 group-focus-within:w-24"
            />
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            Open partnership forms, review tour company applications, and approve operators into the tours workflow.
          </p>
        </div>
        
        {/* Tabs */}
        <div className="flex justify-center mb-4">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            <button
              onClick={() => setActiveTab('jobs')}
              className={`px-6 py-2.5 rounded-md font-medium transition-all duration-300 ease-in-out relative group ${
                activeTab === 'jobs'
                  ? 'bg-[#02665e] text-white shadow-md'
                  : 'text-gray-600 hover:text-[#02665e] hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 
                  size={18} 
                  className={`transition-all duration-300 ${
                    activeTab === 'jobs' 
                      ? 'scale-110' 
                      : 'group-hover:scale-110'
                  }`} 
                />
                <span className="relative z-10">Partnership Forms</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('applications')}
              className={`px-6 py-2.5 rounded-md font-medium transition-all duration-300 ease-in-out relative group ${
                activeTab === 'applications'
                  ? 'bg-[#02665e] text-white shadow-md'
                  : 'text-gray-600 hover:text-[#02665e] hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Users 
                  size={18} 
                  className={`transition-all duration-300 ${
                    activeTab === 'applications' 
                      ? 'scale-110' 
                      : 'group-hover:scale-110'
                  }`} 
                />
                <span className="relative z-10">Company Applications</span>
              </div>
            </button>
          </div>
        </div>

        {activeTab === 'jobs' && (
          <div className="flex justify-center">
            <button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-[#02665e] text-white rounded-lg font-semibold hover:bg-[#024d47] transition-colors"
            >
              <Plus size={20} />
              Open Partnership Form
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle2 size={20} />
          <span>{success}</span>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto overflow-x-hidden">
          <div className="bg-white rounded-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 sm:p-6 flex items-center justify-between z-10 flex-shrink-0">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                {editingJob ? 'Edit Partnership Form' : 'Create Partnership Form'}
              </h2>
              <button
                onClick={resetForm}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              >
                <X size={24} />
              </button>
            </div>

            <div className="overflow-y-auto overflow-x-hidden flex-1 min-w-0">
              <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-6 sm:space-y-8 max-w-full">
              {/* Section 1: Basic Information */}
              <div className="space-y-4">
                <div className="pb-2 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Briefcase size={20} className="text-[#02665e]" />
                    Partnership Basics
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Essential details about the tour company partnership opening</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Partnership Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors box-border"
                      placeholder="e.g., Zanzibar Tour Company Partnership"
                    />
                  </div>

                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Program Owner <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.department}
                      onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors box-border"
                      placeholder="e.g., Tour Operations"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Partnership Classification */}
              <div className="space-y-4">
                <div className="pb-2 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <FileText size={20} className="text-[#02665e]" />
                    Partnership Classification
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Categorize how this company partnership should be reviewed</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Category <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors bg-white box-border"
                    >
                      {CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Engagement Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors bg-white box-border"
                    >
                      {TYPES.map(type => (
                        <option key={type} value={type}>{type.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Readiness Level <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={formData.experienceLevel}
                      onChange={(e) => setFormData({ ...formData, experienceLevel: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors bg-white box-border"
                    >
                      {EXPERIENCE_LEVELS.map(level => (
                        <option key={level} value={level}>{level}</option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Application Deadline
                    </label>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setDeadlinePickerOpen(true)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors box-border bg-white text-left flex items-center justify-between hover:bg-gray-50"
                      >
                        <span className={formData.applicationDeadline ? "text-gray-900" : "text-gray-500"}>
                          {formData.applicationDeadline 
                            ? new Date(formData.applicationDeadline + "T00:00:00").toLocaleDateString('en-US', { 
                                year: 'numeric', 
                                month: 'short', 
                                day: 'numeric' 
                              })
                            : "dd / mm / yyyy"}
                        </span>
                        <Calendar size={18} className="text-gray-400 flex-shrink-0" />
                      </button>
                      {deadlinePickerOpen && (
                        <>
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => setDeadlinePickerOpen(false)} 
                          />
                          <div className="absolute z-50 top-full left-0 mt-2 sm:left-auto sm:right-0">
                            <DatePicker
                              selected={formData.applicationDeadline || undefined}
                              onSelectAction={(date) => {
                                const selectedDate = Array.isArray(date) ? date[0] : date;
                                if (selectedDate) {
                                  setFormData({ ...formData, applicationDeadline: selectedDate });
                                }
                                setDeadlinePickerOpen(false);
                              }}
                              onCloseAction={() => setDeadlinePickerOpen(false)}
                              allowRange={false}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: Location Details */}
              <div className="space-y-4">
                <div className="pb-2 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <MapPin size={20} className="text-[#02665e]" />
                    Operating Area
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Specify where the tour company will operate</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Partnership Mode <span className="text-red-500">*</span>
                    </label>
                    <select
                      required
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors bg-white box-border"
                    >
                      {LOCATIONS.map(loc => (
                        <option key={loc} value={loc}>{loc}</option>
                      ))}
                    </select>
                  </div>

                  <div className="min-w-0">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Area of Operation <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.locationDetail}
                      onChange={(e) => setFormData({ ...formData, locationDetail: e.target.value })}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors box-border"
                      placeholder="e.g., Arusha, Zanzibar, Serengeti"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: Partnership Brief */}
              <div className="space-y-4">
                <div className="pb-2 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <FileText size={20} className="text-[#02665e]" />
                    Partnership Brief
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Describe the partnership opportunity and what kind of tour company should apply</p>
                </div>
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={5}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors resize-none box-border"
                    placeholder="Describe the partnership, tour categories, operating expectations, and what makes this opportunity valuable..."
                  />
                </div>
              </div>

              {/* Section 6: Responsibilities */}
              <div className="space-y-4">
                <div className="pb-2 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Company Expectations</h3>
                  <p className="text-sm text-gray-500 mt-1">List the operating expectations for partner tour companies</p>
                </div>
                <div className="space-y-3">
                  {formData.responsibilities.map((resp, idx) => (
                    <div key={idx} className="flex gap-2 items-center min-w-0">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#02665e]/10 text-[#02665e] flex items-center justify-center text-xs font-semibold">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={resp}
                        onChange={(e) => updateListItem('responsibilities', idx, e.target.value)}
                        className="flex-1 min-w-0 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors box-border"
                        placeholder={`Enter expectation ${idx + 1}...`}
                      />
                      <button
                        type="button"
                        onClick={() => removeListItem('responsibilities', idx)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addListItem('responsibilities')}
                    className="text-sm font-medium text-[#02665e] hover:text-[#024d47] flex items-center gap-1 transition-colors"
                  >
                    <Plus size={16} />
                    Add Expectation
                  </button>
                </div>
              </div>

              {/* Section 7: Requirements */}
              <div className="space-y-4">
                <div className="pb-2 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Approval Requirements</h3>
                  <p className="text-sm text-gray-500 mt-1">Specify documents, licences, and business requirements needed</p>
                </div>
                <div className="space-y-3">
                  {formData.requirements.map((req, idx) => (
                    <div key={idx} className="flex gap-2 items-center min-w-0">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#02665e]/10 text-[#02665e] flex items-center justify-center text-xs font-semibold">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={req}
                        onChange={(e) => updateListItem('requirements', idx, e.target.value)}
                        className="flex-1 min-w-0 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors box-border"
                        placeholder={`Enter requirement ${idx + 1}...`}
                      />
                      <button
                        type="button"
                        onClick={() => removeListItem('requirements', idx)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addListItem('requirements')}
                    className="text-sm font-medium text-[#02665e] hover:text-[#024d47] flex items-center gap-1 transition-colors"
                  >
                    <Plus size={16} />
                    Add Requirement
                  </button>
                </div>
              </div>

              {/* Section 8: Benefits */}
              <div className="space-y-4">
                <div className="pb-2 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Partnership Benefits</h3>
                  <p className="text-sm text-gray-500 mt-1">List benefits offered to approved tour companies</p>
                </div>
                <div className="space-y-3">
                  {formData.benefits.map((benefit, idx) => (
                    <div key={idx} className="flex gap-2 items-center min-w-0">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#02665e]/10 text-[#02665e] flex items-center justify-center text-xs font-semibold">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={benefit}
                        onChange={(e) => updateListItem('benefits', idx, e.target.value)}
                        className="flex-1 min-w-0 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors box-border"
                        placeholder={`Enter benefit ${idx + 1}...`}
                      />
                      <button
                        type="button"
                        onClick={() => removeListItem('benefits', idx)}
                        className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addListItem('benefits')}
                    className="text-sm font-medium text-[#02665e] hover:text-[#024d47] flex items-center gap-1 transition-colors"
                  >
                    <Plus size={16} />
                    Add Benefit
                  </button>
                </div>
              </div>

              {/* Section 9: Publishing Options */}
              <div className="space-y-4">
                <div className="pb-2 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Publishing Options</h3>
                  <p className="text-sm text-gray-500 mt-1">Control visibility and status</p>
                </div>
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={formData.featured}
                        onClick={() => setFormData((prev) => ({ ...prev, featured: !prev.featured }))}
                        className={`mt-0.5 flex h-7 w-12 flex-shrink-0 items-center rounded-full border p-1 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2 ${
                          formData.featured
                            ? "border-[#02665e] bg-[#02665e]"
                            : "border-gray-300 bg-gray-200"
                        }`}
                      >
                        <span
                          className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            formData.featured ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <div>
                        <span className="text-sm font-semibold text-gray-900 block">Featured Partnership</span>
                        <span className="text-xs text-gray-500">Highlight this opening on the public partnership page</span>
                      </div>
                    </div>

                    <div className="flex-1 max-w-xs">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Status
                      </label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] transition-colors bg-white"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="CLOSED">Closed</option>
                        <option value="DRAFT">Draft</option>
                      </select>
                    </div>
                  </div>

                  {/* Tour Company Partnership Toggle */}
                  <div className="border-t border-gray-200 pt-4">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={formData.isTravelAgentPosition}
                        onClick={() =>
                          setFormData((prev) => {
                            const nextIsPartnership = !prev.isTravelAgentPosition;
                            const shouldNormalizeType =
                              nextIsPartnership && EMPLOYMENT_TYPES.includes(prev.type);

                            return {
                              ...prev,
                              isTravelAgentPosition: nextIsPartnership,
                              type: shouldNormalizeType ? "PARTNERSHIP" : prev.type,
                            };
                          })
                        }
                        className={`mt-0.5 flex h-7 w-12 flex-shrink-0 items-center rounded-full border p-1 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2 ${
                          formData.isTravelAgentPosition
                            ? "border-[#02665e] bg-[#02665e]"
                            : "border-gray-300 bg-gray-200"
                        }`}
                      >
                        <span
                          className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            formData.isTravelAgentPosition ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                      <div>
                        <span className="text-sm font-semibold text-gray-900 block">Tour Company Partnership</span>
                        <span className="text-xs text-gray-500">Use this for tour-company onboarding. Approved applications will create an operator account for the company.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-6 border-t border-gray-200">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-6 py-3 bg-[#02665e] text-white rounded-lg font-semibold hover:bg-[#024d47] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : editingJob ? 'Update Partnership Form' : 'Create Partnership Form'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}

      {/* Applications View */}
      {activeTab === 'applications' && (
        <>
          {/* Filters */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Status</label>
                <select
                  value={applicationStatusFilter}
                  onChange={(e) => setApplicationStatusFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e]"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PENDING">Pending</option>
                  <option value="REVIEWING">Reviewing</option>
                  <option value="SHORTLISTED">Shortlisted</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="HIRED">Approved</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Partnership Form</label>
                <select
                  value={applicationJobFilter}
                  onChange={(e) => setApplicationJobFilter(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e]"
                >
                  <option value="ALL">All Partnership Forms</option>
                  {jobs.map(job => (
                    <option key={job.id} value={job.id}>{job.title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Applications List */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {applicationsLoading ? (
              <div className="p-8 text-center text-gray-500">Loading company applications...</div>
            ) : applications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Users className="mx-auto mb-4 text-gray-400" size={48} />
                <p>No company applications found.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                        <button
                          onClick={toggleSelectAll}
                          className="p-1.5 bg-white border border-gray-300 hover:border-[#02665e] hover:bg-[#02665e]/5 rounded-md transition-all duration-300 ease-in-out hover:scale-110 active:scale-95 group"
                          title="Select All"
                        >
                          {allVisibleSelected ? (
                            <CheckSquare size={18} className="text-[#02665e] transition-all duration-300 group-hover:scale-110" />
                          ) : (
                            <Square size={18} className="text-gray-400 transition-all duration-300 group-hover:text-[#02665e] group-hover:scale-110" />
                          )}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <button type="button" onClick={() => handleApplicationSort("companyContact")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                          Company Contact {renderApplicationSortIcon("companyContact")}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <button type="button" onClick={() => handleApplicationSort("partnershipForm")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                          Partnership Form {renderApplicationSortIcon("partnershipForm")}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <button type="button" onClick={() => handleApplicationSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                          Status {renderApplicationSortIcon("status")}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <button type="button" onClick={() => handleApplicationSort("submitted")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-700">
                          Submitted {renderApplicationSortIcon("submitted")}
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {pagedApplications.map((app) => (
                      <tr key={app.id} className={`hover:bg-gray-50 ${selectedApplications.includes(app.id) ? 'bg-blue-50' : ''}`}>
                        <td className="px-4 py-4">
                          <button
                            onClick={() => toggleApplicationSelection(app.id)}
                            className="p-1.5 bg-white border border-gray-300 hover:border-[#02665e] hover:bg-[#02665e]/5 rounded-md transition-all duration-300 ease-in-out hover:scale-110 active:scale-95 group"
                          >
                            {selectedApplications.includes(app.id) ? (
                              <CheckSquare size={18} className="text-[#02665e] transition-all duration-300 group-hover:scale-110" />
                            ) : (
                              <Square size={18} className="text-gray-400 transition-all duration-300 group-hover:text-[#02665e] group-hover:scale-110" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-4">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{app.fullName}</div>
                            <div className="text-sm text-gray-500 flex items-center gap-1">
                              <Mail size={14} />
                              {app.email}
                            </div>
                            <div className="text-sm text-gray-500 flex items-center gap-1 mt-1">
                              <Phone size={14} />
                              {app.phone}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm font-medium text-gray-900">{app.job?.title || 'N/A'}</div>
                          <div className="text-xs text-gray-500">{app.job?.department || ''}</div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(app.status)}`}>
                            {displayStatus(app.status)}
                          </span>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">
                          {formatDate(app.submittedAt)}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                          <button
                            onClick={() => setViewingApplication(app)}
                            className="p-2 bg-gray-50 border border-blue-500/30 text-blue-600 hover:bg-blue-50 hover:border-blue-500 rounded-lg transition-all duration-300 ease-in-out hover:scale-110 hover:shadow-md active:scale-95 group"
                            title="View Details"
                          >
                            <Eye size={16} className="transition-transform duration-300 group-hover:scale-110" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-gray-500">
                    Showing {applicationsStart + 1}-{Math.min(applicationsEnd, sortedApplications.length)} of {sortedApplications.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setApplicationsPage((p) => Math.max(1, p - 1))}
                      disabled={safeApplicationsPage <= 1}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="text-xs font-semibold text-gray-600">
                      Page {safeApplicationsPage} of {totalApplicationPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setApplicationsPage((p) => Math.min(totalApplicationPages, p + 1))}
                      disabled={safeApplicationsPage >= totalApplicationPages}
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Jobs List */}
      {activeTab === 'jobs' && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500">Loading partnership forms...</div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Briefcase className="mx-auto mb-4 text-gray-400" size={48} />
              <p>No partnership forms found. Open your first tour company partnership form.</p>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Partnership</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Program Owner</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Engagement</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Posted</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-4 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{job.title}</span>
                        {job.featured && (
                          <span className="px-2 py-0.5 bg-[#02665e] text-white text-xs rounded-full">Featured</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{job.department}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{job.type.replace('_', ' ')}</td>
                    <td className="px-4 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        job.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                        job.status === 'CLOSED' ? 'bg-gray-100 text-gray-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {displayStatus(job.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600">{formatDate(job.postedDate)}</td>
                    <td className="px-4 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setViewingJob(job)}
                          className="p-2 bg-gray-50 border border-blue-500/30 text-blue-600 hover:bg-blue-50 hover:border-blue-500 rounded-lg transition-all duration-300 ease-in-out hover:scale-110 hover:shadow-md active:scale-95 group"
                          title="View"
                        >
                          <Eye size={16} className="transition-transform duration-300 group-hover:scale-110" />
                        </button>
                        <button
                          onClick={() => handleEdit(job)}
                          className="p-2 bg-gray-50 border border-[#02665e]/30 text-[#02665e] hover:bg-[#02665e]/5 hover:border-[#02665e] rounded-lg transition-all duration-300 ease-in-out hover:scale-110 hover:shadow-md active:scale-95 group"
                          title="Edit"
                        >
                          <Edit size={16} className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                        </button>
                        <button
                          onClick={() => handleDelete(job.id)}
                          className="p-2 bg-gray-50 border border-red-500/30 text-red-600 hover:bg-red-50 hover:border-red-500 rounded-lg transition-all duration-300 ease-in-out hover:scale-110 hover:shadow-md active:scale-95 group"
                          title="Delete"
                        >
                          <Trash2 size={16} className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Application Detail Modal */}
      {viewingApplication && (
        <div className="fixed inset-0 z-[1000] overflow-y-auto bg-black/55">
          <div className="min-h-screen flex items-center justify-center p-1 sm:p-2">
          <div className="relative bg-white rounded-xl w-[99vw] h-[96vh] max-w-none max-h-[96vh] overflow-hidden shadow-2xl flex flex-col">
            {/* Header */}
            <div className="bg-gradient-to-r from-[#02665e] to-[#024d47] px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-white">Company Application Details</h2>
              <button
                onClick={() => setViewingApplication(null)}
                className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 text-white group backdrop-blur-sm"
                title="Close"
              >
                <X size={18} className="transition-transform duration-200 group-hover:rotate-90" />
              </button>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto bg-gray-50 min-w-0 min-h-0">
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                  {/* Company Contact Info */}
                  <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                      <Users size={18} className="text-[#02665e]" />
                      <h3 className="text-base font-semibold text-gray-900">Company Contact Information</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
                        <p className="text-sm font-medium text-gray-900">{viewingApplication.fullName || 'Not provided'}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                        <p className="text-sm text-gray-900 flex items-center gap-1.5 break-all">
                          <Mail size={14} className="text-gray-400" />
                          {viewingApplication.email || 'Not provided'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                        <p className="text-sm text-gray-900 flex items-center gap-1.5">
                          <Phone size={14} className="text-gray-400" />
                          {viewingApplication.phone || 'Not provided'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Nationality</label>
                        <p className="text-sm text-gray-900">
                          {(viewingApplication.agentApplicationData as any)?.nationality || (viewingApplication as any)?.nationality || 'Not provided'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                        <span className={`inline-block px-2.5 py-1 text-xs font-semibold rounded-full ${getStatusColor(viewingApplication.status)}`}>
                          {displayStatus(viewingApplication.status)}
                        </span>
                      </div>
                      {!viewingApplication.agentApplicationData && (
                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <label className="block text-xs font-medium text-gray-500 mb-1">Company / Contact Link</label>
                          {viewingApplication.linkedIn ? (
                            <a
                              href={viewingApplication.linkedIn}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1.5"
                            >
                              <ExternalLink size={14} />
                              View Profile
                            </a>
                          ) : (
                            <p className="text-sm text-gray-500">Not provided</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Partnership Info */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
                      <Briefcase size={18} className="text-[#02665e]" />
                      <h3 className="text-base font-semibold text-gray-900">Application Summary</h3>
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Partnership Form</label>
                        <p className="text-sm font-medium text-gray-900">{viewingApplication.job?.title || 'N/A'}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
                        <p className="text-sm text-gray-900">{viewingApplication.job?.department || 'Not provided'}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Submitted At</label>
                        <p className="text-sm text-gray-900">
                          {viewingApplication.createdAt ? new Date(viewingApplication.createdAt).toLocaleString() : 'Not available'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tour Company Information */}
                {viewingApplication.agentApplicationData && (
                  <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <Users size={18} className="text-[#02665e]" />
                      <h3 className="text-base font-semibold text-gray-900">Tour Company Information</h3>
                    </div>
                    <div className="space-y-4">
                      {(() => {
                        const agentData = viewingApplication.agentApplicationData as any;
                        const profile = normalizePartnershipProfile(
                          agentData?.partnershipProfile && typeof agentData.partnershipProfile === "object"
                            ? agentData.partnershipProfile
                            : (agentData || {}),
                        );
                        const services = profile.services;
                        const serviceClassification = profile.serviceClassification;
                        const tourismTypes = profile.tourismTypes;
                        const toolsAndAssets = profile.toolsAndAssets;
                        const registeredSites = profile.registeredParks;
                        const fleet = profile.fleet;
                        const hasVehicles = profile.hasVehicles;
                        const companyDescription = String(agentData?.bio || viewingApplication.coverLetter || "").trim();
                        const region = agentData?.region ? String(agentData.region) : "";
                        const district = agentData?.district ? String(agentData.district) : "";
                        const languages = Array.isArray(agentData?.languages) ? agentData.languages : [];
                        const specializations = Array.isArray(agentData?.specializations) ? agentData.specializations : [];
                        const certifications = Array.isArray(agentData?.certifications) ? agentData.certifications : [];

                        return (
                          <>
                            {/* Company Profile */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Building2 size={16} className="text-[#02665e]" />
                                1. Company Details
                              </h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Company Name</label>
                                  <p className="text-sm text-gray-900">{profile?.companyName || "Not provided"}</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Company Email</label>
                                  <p className="text-sm text-gray-900">{profile?.companyEmail || "Not provided"}</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Company Phone</label>
                                  <p className="text-sm text-gray-900">{profile?.companyPhone || "Not provided"}</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Company Website</label>
                                  <p className="text-sm text-gray-900 break-all">{profile?.companyWebsite || "Not provided"}</p>
                                </div>
                                <div className="sm:col-span-2">
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Business Address</label>
                                  <p className="text-sm text-gray-900">{profile?.businessAddress || "Not provided"}</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Years in Operation</label>
                                  <p className="text-sm text-gray-900">
                                    {profile?.yearsInOperation !== null && profile?.yearsInOperation !== undefined ? String(profile.yearsInOperation) : "Not provided"}
                                  </p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Team Size</label>
                                  <p className="text-sm text-gray-900">
                                    {profile?.teamSize !== null && profile?.teamSize !== undefined ? String(profile.teamSize) : "Not provided"}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Company Description */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2">1.1 Company Details - Company Narrative</h4>
                              <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-md p-3 border border-gray-100">
                                {companyDescription || "Not provided"}
                              </p>
                            </div>

                            {/* Languages */}
                            {languages.length > 0 && (
                              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                  <Languages size={16} className="text-[#02665e]" />
                                  1.2 Company Details - Contact Languages
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                  {languages.map((lang: string, idx: number) => (
                                    <span key={idx} className="inline-flex items-center px-3 py-1 bg-purple-50 text-purple-700 rounded-lg text-sm border border-purple-200">
                                      {lang}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Tourism Types */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Briefcase size={16} className="text-[#02665e]" />
                                2. Tourism Serving - Tourism Types
                              </h4>
                              {tourismTypes.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {tourismTypes.map((tourismType: string, idx: number) => (
                                    <span key={idx} className="inline-flex items-center px-3 py-1 bg-sky-50 text-sky-700 rounded-lg text-sm border border-sky-200">
                                      {tourismType}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">No tourism types submitted.</p>
                              )}
                            </div>

                            {/* Company Services */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Handshake size={16} className="text-[#02665e]" />
                                2.1 Tourism Serving - Services
                              </h4>
                              {Object.keys(serviceClassification).length > 0 ? (
                                <div className="space-y-3">
                                  {Object.entries(serviceClassification).map(([category, items]) => (
                                    <div key={category} className="rounded-lg border border-slate-200 bg-white p-3">
                                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">{category}</p>
                                      <div className="flex flex-wrap gap-2">
                                        {items.map((service: string, idx: number) => (
                                          <span
                                            key={`${category}-${idx}-${service}`}
                                            className="inline-flex items-center px-3 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-sm border border-emerald-200"
                                          >
                                            {service}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : services.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {services.map((service: string, idx: number) => (
                                    <span key={idx} className="inline-flex items-center px-3 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-sm border border-emerald-200">
                                      {service}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">No services submitted.</p>
                              )}
                            </div>

                            {/* Specializations */}
                            {specializations.length > 0 && (
                              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                  <Briefcase size={16} className="text-[#02665e]" />
                                  2.2 Tourism Serving - Specializations
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                  {specializations.map((spec: string, idx: number) => (
                                    <span key={idx} className="inline-flex items-center px-3 py-1 bg-green-50 text-green-700 rounded-lg text-sm border border-green-200">
                                      {spec}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Permitted Parks / Tour Sites */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <MapPin size={16} className="text-[#02665e]" />
                                3. Area of Operation - Permitted Parks &amp; Tour Sites
                              </h4>
                              {registeredSites.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {registeredSites.map((site: string, idx: number) => (
                                    <span key={idx} className="inline-flex items-center px-3 py-1 bg-cyan-50 text-cyan-700 rounded-lg text-sm border border-cyan-200">
                                      {site}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">No permitted parks/tour sites submitted.</p>
                              )}
                            </div>

                            {/* Location */}
                            {(region || district) && (
                              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                                <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                  <MapPin size={16} className="text-[#02665e]" />
                                  3.1 Area of Operation - Location
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  {region && (
                                    <div>
                                      <label className="block text-xs font-medium text-gray-500 mb-1">Region</label>
                                      <p className="text-sm text-gray-900">{region}</p>
                                    </div>
                                  )}
                                  {district && (
                                    <div>
                                      <label className="block text-xs font-medium text-gray-500 mb-1">District</label>
                                      <p className="text-sm text-gray-900">{district}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Tools & Assets */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Briefcase size={16} className="text-[#02665e]" />
                                4. Tools &amp; Fleet - Tools &amp; Assets
                              </h4>
                              {toolsAndAssets.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {toolsAndAssets.map((tool: string, idx: number) => (
                                    <span key={idx} className="inline-flex items-center px-3 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-sm border border-indigo-200">
                                      {tool}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">No tools/assets submitted.</p>
                              )}
                            </div>

                            {/* Fleet / Vehicles */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <Briefcase size={16} className="text-[#02665e]" />
                                4.1 Tools &amp; Fleet - Fleet &amp; Vehicles
                              </h4>
                              <div className="mb-2">
                                <label className="block text-xs font-medium text-gray-500 mb-1">Has Vehicles</label>
                                <p className="text-sm text-gray-900">{hasVehicles ? "Yes" : "No"}</p>
                              </div>
                              {fleet.length > 0 ? (
                                <div className="space-y-2">
                                  {fleet.map((v: any, idx: number) => (
                                    <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                                      <div className="font-medium text-slate-900 text-sm">{v?.type || "Vehicle type not provided"}</div>
                                      <div className="text-sm text-slate-700 mt-1">
                                        {v?.count ?? "-"} vehicle{Number(v?.count) === 1 ? "" : "s"} • {v?.capacity ?? "-"} seat{Number(v?.capacity) === 1 ? "" : "s"} each • {v?.ownership === "rented" ? "Rented" : v?.ownership === "leased" ? "Leased" : "Company Owned"}
                                        {v?.registrationNumber ? ` • Reg: ${v.registrationNumber}` : ""}
                                        {v?.serviceMode ? ` • Mode: ${v.serviceMode}` : ""}
                                        {v?.condition ? ` • ${v.condition}` : ""}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">No vehicle records submitted.</p>
                              )}
                            </div>

                            {/* Compliance & Registration */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                                <CheckCircle2 size={16} className="text-[#02665e]" />
                                5. Compliance &amp; Submit - Registration Details
                              </h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Business Registration Number (BRELA)</label>
                                  <p className="text-sm text-gray-900">{profile?.businessRegistrationNumber || "Not provided"}</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">TIN Number</label>
                                  <p className="text-sm text-gray-900">{profile?.tinNumber || "Not provided"}</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Business License Number</label>
                                  <p className="text-sm text-gray-900">{profile?.businessLicenseNumber || "Not provided"}</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Tourism Permit Number</label>
                                  <p className="text-sm text-gray-900">{profile?.tourismPermitNumber || "Not provided"}</p>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-500 mb-1">Vehicle Permit Number</label>
                                  <p className="text-sm text-gray-900">{profile?.vehiclePermitNumber || "Not provided"}</p>
                                </div>
                              </div>
                            </div>

                            {/* Company Licenses & Certifications */}
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2">5.1 Compliance &amp; Submit - Licenses &amp; Certifications</h4>
                              {certifications.length > 0 ? (
                                <div className="space-y-2">
                                  {certifications.map((cert: any, idx: number) => (
                                    <div key={idx} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                      <div className="font-medium text-amber-900">{cert.name || "License/Certification"}</div>
                                      <div className="text-sm text-amber-700">
                                        {cert.issuer || "Issuer not provided"} - {cert.year || "Year not provided"}
                                        {cert.expiryDate && ` - Expires: ${cert.expiryDate}`}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-gray-500">Not provided.</p>
                              )}
                            </div>
                          </>
                        );
                      })()}

                      {/* Operator Profile Created Indicator */}
                      {viewingApplication.agent && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 size={16} className="text-green-600" />
                            <span className="text-sm font-medium text-green-800">Tour company operator account has been created</span>
                          </div>
                          <p className="text-xs text-green-700 mt-1">This application was approved and the existing operator engine created the company account.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Application Document */}
                {(viewingApplication.resumeFileName || viewingApplication.resumeStorageKey || viewingApplication.resumeUrl) && (
                  <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <FileText size={18} className="text-[#02665e]" />
                      <h3 className="text-base font-semibold text-gray-900">Application Document</h3>
                    </div>
                    {/* Check if document is actually available (has storage key or URL) */}
                    {(viewingApplication.resumeStorageKey || viewingApplication.resumeUrl) ? (
                      <div 
                        onClick={() => handleViewResume(viewingApplication.id)}
                        className="flex items-center justify-between gap-4 p-4 bg-gray-50 rounded-md border border-gray-200 hover:border-[#02665e] hover:bg-gray-100 cursor-pointer transition-all group"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="p-2 bg-white rounded-md group-hover:bg-[#02665e]/10 transition-colors">
                            <FileText size={20} className="text-[#02665e] flex-shrink-0" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate group-hover:text-[#02665e] transition-colors">
                              {viewingApplication.resumeFileName || 'Application Document'}
                            </p>
                            {viewingApplication.resumeSize && (
                              <p className="text-xs text-gray-500 mt-0.5">
                                {(viewingApplication.resumeSize / 1024).toFixed(2)} KB
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewResume(viewingApplication.id);
                            }}
                            className="px-4 py-2 bg-[#02665e] text-white rounded-md hover:bg-[#024d47] transition-colors flex items-center gap-2 text-sm font-medium"
                          >
                            <Eye size={16} />
                            View
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${viewingApplication.id}/resume`;
                                const r = await fetch(url, { credentials: 'include' });
                                if (!r.ok) {
                                  const errorData = await r.json().catch(() => ({}));
                                  throw new Error(errorData.error || `Failed to get resume URL: ${r.status}`);
                                }
                                const data = await r.json();
                                if (!data.url) {
                                  throw new Error('Application document URL not available');
                                }
                                window.open(data.url, '_blank');
                              } catch (err: any) {
                                console.error('Error downloading application document:', err);
                                setError(err.message || 'Failed to download application document');
                                setTimeout(() => setError(null), 5000);
                              }
                            }}
                            className="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm font-medium"
                          >
                            <Download size={16} />
                            Download
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 bg-yellow-50 rounded-md border border-yellow-200">
                        <p className="text-sm text-yellow-800">
                          <strong>Document not available:</strong> The application document was not successfully uploaded or is no longer accessible.
                          {viewingApplication.resumeFileName && (
                            <span className="block mt-1 text-xs text-yellow-700">
                              Original filename: {viewingApplication.resumeFileName}
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Admin Notes */}
                <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                  <h3 className="text-base font-semibold text-gray-900 mb-3">Admin Notes</h3>
                  <textarea
                    value={viewingApplication.adminNotes || ''}
                    onChange={(e) => setViewingApplication({ ...viewingApplication, adminNotes: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] text-sm resize-none"
                    rows={4}
                    style={{ maxHeight: '120px', overflowY: 'auto' }}
                    placeholder="Add notes about this application..."
                  />
                </div>

                {/* Status Update */}
                <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                  <h3 className="text-base font-semibold text-gray-900 mb-3">Update Status</h3>
                  
                  {/* Current Status Display */}
                  {viewingApplication.status && (
                    <div className="mb-4 pb-3 border-b border-gray-200">
                      <p className="text-sm text-gray-600 mb-1">Current status:</p>
                      <span className={`inline-block px-3 py-1 text-xs font-semibold rounded-full ${getStatusColor(viewingApplication.status)}`}>
                        {displayStatus(viewingApplication.status)}
                      </span>
                    </div>
                  )}
                  
                  {/* All Status Buttons - Available for workflow transitions */}
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Change status to:</p>
                    <div className="flex flex-wrap gap-2">
                      {['PENDING', 'REVIEWING', 'SHORTLISTED', 'REJECTED', 'HIRED'].map((status) => {
                        const isCurrentStatus = viewingApplication.status === status;
                        const isUpdating = updatingStatus === viewingApplication.id;
                        const isFinalized = viewingApplication.status === 'HIRED' || viewingApplication.status === 'REJECTED';
                        const isDisabled = isUpdating || isFinalized;
                        
                        return (
                          <button
                            key={status}
                            onClick={() => {
                              if (!isDisabled && !isCurrentStatus) {
                                updateApplicationStatus(viewingApplication.id, status, viewingApplication.adminNotes);
                              }
                            }}
                            disabled={isDisabled || isCurrentStatus}
                            className={`px-4 py-2.5 rounded-lg text-xs font-semibold transition-all duration-300 ease-in-out flex-shrink-0 ${
                              isCurrentStatus
                                ? 'bg-[#02665e] text-white shadow-md cursor-default scale-105'
                                : isDisabled
                                ? 'bg-white text-gray-400 border border-gray-200 cursor-not-allowed opacity-60'
                                : 'bg-white text-gray-700 border border-gray-300 hover:bg-[#02665e] hover:text-white hover:border-[#02665e] hover:shadow-md hover:scale-105 active:scale-95 cursor-pointer'
                            }`}
                            title={
                              isCurrentStatus
                                ? 'This is the current status'
                                : isUpdating
                                ? 'Updating status...'
                                : isFinalized
                                ? 'Finalized: status changes are disabled'
                                : `Change status to ${displayStatus(status)}`
                            }
                          >
                            {displayStatus(status)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-500 mt-3 italic">
                      Note: Email notifications are sent only when the status actually changes.
                    </p>
                  </div>
                </div>

                {/* Contract Workflow */}
                <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                  <h3 className="text-base font-semibold text-gray-900 mb-3">Contract Workflow</h3>
                  {String(viewingApplication.status || '').toUpperCase() !== 'HIRED' ? (
                    <p className="text-sm text-gray-600">Contract controls become available after the application is approved.</p>
                  ) : contractWorkflowLoading ? (
                    <p className="text-sm text-gray-600">Loading contract workflow...</p>
                  ) : (
                    <>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs text-gray-500 mb-1">Current Contract State</p>
                        <p className="text-sm font-semibold text-gray-900">
                          {contractWorkflow?.status === 'PENDING_NOLSAF_SIGNATURE'
                            ? 'Awaiting NoLSAF signature'
                            : contractWorkflow?.status === 'PENDING_AGENT_SIGNATURE'
                              ? 'Awaiting operator countersignature'
                              : contractWorkflow?.status === 'EXECUTED'
                                ? 'Executed'
                                : 'Not prepared'}
                        </p>
                        {contractWorkflow?.contractId ? (
                          <p className="text-xs text-gray-500 mt-1">Contract ID: {contractWorkflow.contractId}</p>
                        ) : null}
                        {contractWorkflow?.nolsafSignedAt ? (
                          <p className="text-xs text-gray-500 mt-1">
                            NoLSAF signed at: {new Date(contractWorkflow.nolsafSignedAt).toLocaleString()}
                          </p>
                        ) : null}
                        {contractWorkflow?.agentSignedAt ? (
                          <p className="text-xs text-gray-500 mt-1">
                            Operator signed at: {new Date(contractWorkflow.agentSignedAt).toLocaleString()}
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handlePrepareContractWorkflow}
                          disabled={Boolean(contractWorkflow) || contractActionLoading !== null}
                          className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                            Boolean(contractWorkflow) || contractActionLoading !== null
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-slate-900 text-white hover:bg-slate-800'
                          }`}
                        >
                          {contractActionLoading === 'prepare' ? 'Preparing...' : 'Prepare Draft'}
                        </button>
                        <button
                          type="button"
                          onClick={handleAdminSignContract}
                          disabled={contractWorkflow?.status !== 'PENDING_NOLSAF_SIGNATURE' || contractActionLoading !== null}
                          className={`px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
                            contractWorkflow?.status !== 'PENDING_NOLSAF_SIGNATURE' || contractActionLoading !== null
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-[#02665e] text-white hover:bg-[#024d47]'
                          }`}
                        >
                          {contractActionLoading === 'sign' ? 'Signing...' : 'Sign As NoLSAF'}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* Legal Audit Timeline */}
                <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock size={18} className="text-[#02665e]" />
                    <h3 className="text-base font-semibold text-gray-900">Legal Audit Timeline</h3>
                  </div>

                  {auditTimelineLoading ? (
                    <p className="text-sm text-gray-600">Loading legal traceability events...</p>
                  ) : auditTimeline.length === 0 ? (
                    <p className="text-sm text-gray-600">No audit events available yet for this application.</p>
                  ) : (
                    <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                      {auditTimeline.slice(0, 12).map((entry) => (
                        <div key={entry.id} className="relative pl-6 pb-3 border-l border-gray-200 last:pb-0">
                          <span className="absolute -left-[7px] top-1.5 h-3.5 w-3.5 rounded-full bg-[#02665e] ring-2 ring-white" />
                          <div className="text-sm font-semibold text-gray-900">{formatAuditAction(entry.action)}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {new Date(entry.createdAt).toLocaleString()} • {entry.actorName || 'System'}
                            {entry.actorRole ? ` (${entry.actorRole})` : ''}
                          </div>
                          <div className="text-sm text-gray-700 mt-1">{summarizeAuditEvent(entry)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Status History */}
                {viewingApplication.usedStatuses && Array.isArray(viewingApplication.usedStatuses) && viewingApplication.usedStatuses.length > 0 && (
                  <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Clock size={18} className="text-[#02665e]" />
                      <h3 className="text-base font-semibold text-gray-900">Status History</h3>
                    </div>
                    <div className="space-y-2">
                      {viewingApplication.usedStatuses.map((status: string, index: number) => (
                        <div key={index} className="flex items-center gap-3 p-2 bg-gray-50 rounded-md">
                          <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${getStatusColor(status)}`}>
                            {displayStatus(status)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {index === viewingApplication.usedStatuses.length - 1 ? 'Current' : 'Previously used'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Submission Info */}
                <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-xs text-gray-500 space-x-4 flex-wrap">
                    <span>Submitted: {formatDate(viewingApplication.submittedAt)}</span>
                    {viewingApplication.reviewedAt && (
                      <span>• Reviewed: {formatDate(viewingApplication.reviewedAt)}</span>
                    )}
                    {viewingApplication.reviewedByUser && (
                      <span>• By: {viewingApplication.reviewedByUser.name || viewingApplication.reviewedByUser.email}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 bg-white px-6 py-4 flex justify-end gap-3 flex-shrink-0">
              <button
                onClick={() => setViewingApplication(null)}
                className="px-6 py-2.5 bg-white border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 hover:shadow-sm transition-all duration-300 ease-in-out active:scale-95 text-sm"
              >
                Close
              </button>
              <button
                onClick={() => {
                  updateApplicationStatus(viewingApplication.id, viewingApplication.status, viewingApplication.adminNotes);
                }}
                className="px-6 py-2.5 bg-[#02665e] text-white rounded-lg font-medium hover:bg-[#024d47] hover:shadow-md transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 text-sm"
              >
                Save Notes
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Application Document Viewer Modal */}
      {viewingResume && resumeViewUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="bg-white rounded-xl max-w-5xl w-full max-h-[95vh] overflow-hidden shadow-2xl flex flex-col">
            <div className="bg-gradient-to-r from-[#02665e] to-[#024d47] px-6 py-4 flex items-center justify-between flex-shrink-0">
              <h2 className="text-xl font-bold text-white">Application Document Viewer</h2>
              <div className="flex items-center gap-3">
                <a
                  href={resumeViewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-md transition-colors flex items-center gap-2 text-sm font-medium"
                >
                  <Download size={16} />
                  Download
                </a>
                <button
                  onClick={() => {
                    setViewingResume(false);
                    setResumeViewUrl(null);
                  }}
                  className="p-2 bg-white/10 hover:bg-white/20 border border-white/20 hover:border-white/30 rounded-lg transition-all duration-200 text-white group backdrop-blur-sm"
                  title="Close"
                >
                  <X size={18} className="transition-transform duration-200 group-hover:rotate-90" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6 bg-gray-100 min-w-0 min-h-0">
              <div className="bg-white rounded-lg p-6 shadow-sm">
                <PDFViewer url={resumeViewUrl} />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Delete Confirmation Modal */}
      {deleteConfirmId !== null && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="delete-confirm-title">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !isDeleting && setDeleteConfirmId(null)} />
          <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-gray-100 overflow-hidden">
            {/* Red accent top bar */}
            <div className="h-1 w-full bg-gradient-to-r from-red-500 via-red-400 to-rose-500" />
            <div className="p-6">
              {/* Icon + heading */}
              <div className="flex items-start gap-4 mb-4">
                <div className="shrink-0 h-10 w-10 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M10 2a8 8 0 1 0 0 16A8 8 0 0 0 10 2Zm0 4.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6.5Zm0 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75Z" fill="#ef4444" />
                  </svg>
                </div>
                <div>
                  <h2 id="delete-confirm-title" className="text-[15px] font-bold text-gray-900">Delete partnership form?</h2>
                  <p className="mt-1 text-sm text-gray-500 leading-relaxed">
                    This will permanently remove the partnership form and cannot be undone.
                  </p>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDeleteConfirmed}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm disabled:opacity-60"
                >
                  {isDeleting ? (
                    <>
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden />
                      Deleting…
                    </>
                  ) : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
