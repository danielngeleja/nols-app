"use client";
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Plus, Edit, Trash2, Eye, X, Calendar, MapPin, Clock, CheckCircle2, FileText, Users, Download, Handshake, ChevronRight, LayoutGrid, List, Loader2, RefreshCw, Search } from "lucide-react";
import TablePagination from "@/components/TablePagination";
import ApplicationRecord, { APPLICATION_STAGES, applicationCompany, applicationReference, stageOf } from "./ApplicationRecord";
import PDFViewer from "@/components/PDFViewer";
import DatePicker from "@/components/ui/DatePicker";
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
  // What the admin types, and the settled value sent to the API after a short pause.
  const [applicationSearchInput, setApplicationSearchInput] = useState('');
  const [applicationSearch, setApplicationSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setApplicationSearch(applicationSearchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [applicationSearchInput]);
  const [applicationsPage, setApplicationsPage] = useState(1);
  const [applicationSortBy, setApplicationSortBy] = useState<"companyContact" | "partnershipForm" | "status" | "submitted">("submitted");
  const [applicationSortDir, setApplicationSortDir] = useState<"asc" | "desc">("desc");
  
  const [statistics, setStatistics] = useState<any>(null);
  // Cards or list for the applications directory, remembered per admin like the Sales directory.
  const [applicationView, setApplicationView] = useState<'cards' | 'list'>('cards');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('admin.tourPartnerships.view');
      if (saved === 'cards' || saved === 'list') setApplicationView(saved);
    } catch {}
  }, []);
  const changeApplicationView = (next: 'cards' | 'list') => {
    setApplicationView(next);
    try { window.localStorage.setItem('admin.tourPartnerships.view', next); } catch {}
  };
  const [savingNotes, setSavingNotes] = useState(false);

  // Esc closes the application review.
  const reviewOpen = Boolean(viewingApplication);
  useEffect(() => {
    if (!reviewOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewingApplication(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewOpen]);
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

  // The header and KPI row show application figures on both tabs.
  useEffect(() => {
    loadStatistics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const downloadApplicationDocument = async (applicationId: number) => {
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${applicationId}/resume`;
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) {
        const errorData = await r.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to get document URL: ${r.status}`);
      }
      const data = await r.json();
      if (!data.url) throw new Error('Application document URL not available');
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err.message || 'Failed to download application document');
      setTimeout(() => setError(null), 5000);
    }
  };

  // Notes are saved on their own: the status update refuses an unchanged status,
  // so routing notes through it never saved them.
  const saveApplicationNotes = async (applicationId: number, notes: string) => {
    if (savingNotes) return;
    setSavingNotes(true);
    try {
      const url = `${apiBase.replace(/\/$/, '')}/api/admin/careers/applications/${applicationId}`;
      const r = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ adminNotes: notes }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to save notes');
      }
      setApplications((prev) => prev.map((item) => (item.id === applicationId ? { ...item, adminNotes: notes } : item)));
      setSuccess('Admin notes saved.');
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e?.message || 'Failed to save notes');
      setTimeout(() => setError(null), 5000);
    } finally {
      setSavingNotes(false);
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

  const activeForms = jobs.filter((job) => job.status === 'ACTIVE').length;
  const dist = (statistics?.statusDistribution || {}) as Record<string, number>;
  const totalApplications = Number(statistics?.overview?.totalApplications ?? 0);
  const awaitingReview = (dist.PENDING || 0) + (dist.REVIEWING || 0);
  const approvedShare = totalApplications > 0 ? Math.round(((dist.HIRED || 0) / totalApplications) * 100) : 0;
  // Ghost buttons sitting on the dark header, as on the Sales pages.
  const heroButton = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";

  return (
    <div className="box-border w-full min-w-0 space-y-5">
      {/* Header: dark brand band with headline numbers and the page's two views as tabs */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Tours</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour partnerships</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Open partnership forms, review tour company applications and approve operators into the tours workflow.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { resetForm(); setShowForm(true); }} className={heroButton}>
                <Plus className="h-3.5 w-3.5" /> Open partnership form
              </button>
              <button
                type="button"
                onClick={() => { void loadJobs(); void loadStatistics(); if (activeTab === 'applications') void loadApplications(); }}
                disabled={loading || applicationsLoading}
                className={`${heroButton} w-9 px-0`}
                aria-label="Refresh"
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading || applicationsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Headline numbers */}
          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{statistics ? totalApplications.toLocaleString() : '...'}</p>
              <p className="m-0 mt-1 text-xs text-white/55">{totalApplications === 1 ? 'Application' : 'Applications'} received</p>
            </div>
            <div>
              <p className={`m-0 text-3xl font-bold tabular-nums leading-none ${awaitingReview > 0 ? 'text-amber-300' : 'text-white'}`}>{statistics ? awaitingReview.toLocaleString() : '...'}</p>
              <p className="m-0 mt-1 text-xs text-white/55">Waiting for a decision</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-emerald-300">{approvedShare}%</p>
              <p className="m-0 mt-1 text-xs text-white/55">Approved as operators</p>
            </div>
            <div>
              <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{activeForms}<span className="text-lg text-white/40"> / {jobs.length}</span></p>
              <p className="m-0 mt-1 text-xs text-white/55">Forms open to applications</p>
            </div>
          </div>

          <div className="mt-5 flex gap-1" role="tablist" aria-label="Tour partnership views">
            {([['applications', 'Applications', Users], ['jobs', 'Partnership forms', Briefcase]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeTab === key}
                onClick={() => setActiveTab(key)}
                className={`relative inline-flex h-11 cursor-pointer items-center gap-2 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${activeTab === key ? 'text-white' : 'text-white/50 hover:text-white/80'}`}
              >
                <Icon className="h-4 w-4" /> {label}
                {activeTab === key && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-emerald-400" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800" role="alert">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{success}</span>
          <button type="button" onClick={() => setSuccess(null)} className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
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
          {/* Lifecycle track: where every application sits, and a one-click filter */}
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
              {APPLICATION_STAGES.map((stage, idx) => {
                const n = dist[stage.key] || 0;
                const share = totalApplications > 0 ? Math.round((n / totalApplications) * 100) : 0;
                const selected = applicationStatusFilter === stage.key;
                return (
                  <button
                    key={stage.key}
                    type="button"
                    onClick={() => setApplicationStatusFilter((current) => (current === stage.key ? 'ALL' : stage.key))}
                    aria-pressed={selected}
                    className={`group relative min-w-0 cursor-pointer rounded-xl border border-solid p-3.5 text-left transition-all ${
                      selected ? `border-neutral-900 ${stage.soft}` : 'border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${stage.text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} /> {stage.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-neutral-400">{idx < 4 ? `Step ${idx + 1}` : `${share}%`}</span>
                    </span>
                    <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{statistics ? n.toLocaleString() : '...'}</span>
                    <span className="mt-1 block truncate text-[11px] text-neutral-500">{stage.hint}</span>
                    <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                      <span className={`block h-full rounded-full ${stage.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Directory */}
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 className="m-0 text-sm font-bold text-neutral-900">
                  {applicationStatusFilter !== 'ALL' ? `${stageOf(applicationStatusFilter)?.label || applicationStatusFilter} applications` : 'All applications'}
                </h2>
                <p className="m-0 text-xs tabular-nums text-neutral-400">
                  {applicationsLoading ? 'Loading' : `${sortedApplications.length.toLocaleString()} ${sortedApplications.length === 1 ? 'result' : 'results'}`}
                </p>
              </div>
              {applicationStatusFilter !== 'ALL' && (
                <button type="button" onClick={() => setApplicationStatusFilter('ALL')} className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
                  <X className="h-3 w-3" /> Show all
                </button>
              )}
              <div className="ml-auto flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
                <div className="relative min-w-0 flex-1 lg:w-72 lg:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    value={applicationSearchInput}
                    onChange={(e) => setApplicationSearchInput(e.target.value)}
                    className="box-border h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                    placeholder="Search contact, email or phone"
                    aria-label="Search applications"
                  />
                  {applicationSearchInput && (
                    <button type="button" onClick={() => setApplicationSearchInput('')} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <select
                  value={applicationJobFilter}
                  onChange={(e) => setApplicationJobFilter(e.target.value)}
                  aria-label="Filter by partnership form"
                  className="box-border h-9 min-w-0 max-w-[14rem] cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All forms</option>
                  {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                </select>
                <select
                  value={`${applicationSortBy}:${applicationSortDir}`}
                  onChange={(e) => {
                    const [by, dir] = e.target.value.split(':') as [ApplicationSortField, 'asc' | 'desc'];
                    setApplicationSortBy(by);
                    setApplicationSortDir(dir);
                  }}
                  aria-label="Sort applications"
                  className="box-border h-9 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-sm text-neutral-700 outline-none focus:border-emerald-500"
                >
                  <option value="submitted:desc">Newest first</option>
                  <option value="submitted:asc">Oldest first</option>
                  <option value="companyContact:asc">Contact A to Z</option>
                  <option value="status:asc">By stage</option>
                </select>
                <div className="hidden rounded-lg bg-neutral-100 p-0.5 md:inline-flex" role="group" aria-label="Directory layout">
                  {([['cards', LayoutGrid, 'Cards'], ['list', List, 'List']] as const).map(([key, Icon, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => changeApplicationView(key)}
                      aria-pressed={applicationView === key}
                      title={label}
                      className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-0 transition-colors ${applicationView === key ? 'bg-white text-neutral-900 shadow-sm' : 'bg-transparent text-neutral-400 hover:text-neutral-700'}`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {applicationsLoading && applications.length === 0 ? (
              <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading applications
              </div>
            ) : applications.length === 0 ? (
              <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
                <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
                  <Users className="h-5 w-5" />
                </span>
                <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No matching applications</p>
                <p className="m-0 mt-1 text-xs text-neutral-500">
                  {applicationSearch || applicationStatusFilter !== 'ALL' || applicationJobFilter !== 'ALL' ? 'Try another stage, form or search.' : 'Applications appear here once tour companies apply through an open form.'}
                </p>
              </div>
            ) : (
              <div className={`transition-opacity ${applicationsLoading ? 'opacity-60' : ''}`}>
                {applicationView === 'list' ? (
                  <div className="hidden overflow-x-auto border-0 border-t border-solid border-neutral-100 md:block">
                    <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="text-[11px] font-semibold text-neutral-400">
                          <th className="px-4 py-2.5 font-semibold sm:pl-5">Company</th>
                          <th className="px-4 py-2.5 font-semibold">Reference</th>
                          <th className="px-4 py-2.5 font-semibold">Stage</th>
                          <th className="px-4 py-2.5 font-semibold">Partnership form</th>
                          <th className="px-4 py-2.5 font-semibold">Region</th>
                          <th className="px-4 py-2.5 font-semibold">Submitted</th>
                          <th className="px-4 py-2.5 sm:pr-5"><span className="sr-only">Open</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedApplications.map((app) => {
                          const stage = stageOf(app.status);
                          const company = applicationCompany(app);
                          return (
                            <tr key={app.id} onClick={() => setViewingApplication(app)} className="cursor-pointer border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-neutral-50/70">
                              <td className="px-4 py-3 sm:pl-5">
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white ring-2 ring-offset-2 ${stage?.ring || 'ring-neutral-300'}`}>{initials(company)}</span>
                                  <div className="min-w-0">
                                    <div className="max-w-[16rem] truncate font-medium text-neutral-900">{tidyName(company)}</div>
                                    <div className="max-w-[16rem] truncate text-xs text-neutral-400">{app.fullName || app.email || 'No contact'}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-neutral-600">{applicationReference(app.id)}</td>
                              <td className="px-4 py-3">
                                <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${stage?.text || 'text-neutral-600'}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${stage?.dot || 'bg-neutral-400'}`} /> {stage?.label || displayStatus(app.status)}
                                </span>
                              </td>
                              <td className="max-w-[14rem] truncate px-4 py-3 text-neutral-700">{tidyName(app.job?.title) || 'Form removed'}</td>
                              <td className={`px-4 py-3 ${app.agentApplicationData?.region ? 'text-neutral-700' : 'text-neutral-400'}`}>{app.agentApplicationData?.region || 'Not set'}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{app.submittedAt ? formatDate(app.submittedAt) : 'Not set'}</td>
                              <td className="px-4 py-3 text-right sm:pr-5"><ChevronRight className="ml-auto h-4 w-4 text-neutral-300" aria-hidden /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {/* Cards: always on phones, and on desktop when the Cards layout is chosen */}
                <div className={`grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3 2xl:grid-cols-4 ${applicationView === 'list' ? 'md:hidden' : ''}`}>
                  {pagedApplications.map((app) => {
                    const stage = stageOf(app.status);
                    const company = applicationCompany(app);
                    const finalStage = app.status === 'HIRED' || app.status === 'REJECTED';
                    const waitingDays = app.submittedAt ? Math.max(0, Math.floor((Date.now() - new Date(app.submittedAt).getTime()) / 86_400_000)) : null;
                    return (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => setViewingApplication(app)}
                        className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white p-0 text-left transition-all hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-[0_12px_28px_-18px_rgba(11,36,32,0.45)]"
                      >
                        <span className="flex items-start gap-3 px-4 pt-4">
                          <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white ring-2 ring-offset-2 ${stage?.ring || 'ring-neutral-300'}`}>
                            {initials(company)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-neutral-900">{tidyName(company)}</span>
                            <span className="block truncate text-xs text-neutral-400">{app.fullName || app.email || 'No contact'}</span>
                          </span>
                          <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-500" aria-hidden />
                        </span>

                        <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4">
                          <span className="rounded-md border border-dashed border-neutral-300 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700">{applicationReference(app.id)}</span>
                          <span className="min-w-0 truncate text-xs text-neutral-600">{tidyName(app.job?.title) || 'Form removed'}</span>
                        </span>

                        <span className="mt-2 flex items-center gap-1.5 px-4 text-xs text-neutral-500">
                          <MapPin className="h-3.5 w-3.5 text-neutral-400" /> {app.agentApplicationData?.region || 'Region not set'}
                        </span>

                        <span className={`mt-3 flex items-center gap-1.5 px-4 py-2 text-xs ${stage?.soft || 'bg-neutral-50'} ${stage?.text || 'text-neutral-600'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${stage?.dot || 'bg-neutral-400'}`} />
                          <span className="font-semibold">{stage?.label || displayStatus(app.status)}</span>
                          <span className="truncate opacity-80">· {stage?.hint || ''}</span>
                        </span>

                        <span className="grid grid-cols-3 gap-px bg-neutral-100">
                          {[
                            ['Submitted', app.submittedAt ? new Date(app.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'Not set'],
                            ['Waiting', finalStage ? 'Decided' : waitingDays === null ? 'Not set' : `${waitingDays} ${waitingDays === 1 ? 'day' : 'days'}`],
                            ['Document', app.resumeStorageKey || app.resumeUrl ? 'Attached' : 'None'],
                          ].map(([label, value]) => (
                            <span key={label} className="min-w-0 bg-white px-3 py-2.5">
                              <span className="block text-[10px] text-neutral-400">{label}</span>
                              <span className="block truncate text-sm font-semibold tabular-nums text-neutral-900">{value}</span>
                            </span>
                          ))}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <TablePagination page={safeApplicationsPage} pageSize={applicationsPageSize} total={sortedApplications.length} onPageChange={setApplicationsPage} />
              </div>
            )}
          </section>
        </>
      )}

      {/* Partnership forms */}
      {activeTab === 'jobs' && (
        <section className="rounded-2xl border border-solid border-neutral-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Partnership forms</h2>
              <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? 'Loading' : `${activeForms} open of ${jobs.length}`}</p>
            </div>
            <button type="button" onClick={() => { resetForm(); setShowForm(true); }} className="ml-auto inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800">
              <Plus className="h-4 w-4" /> Open partnership form
            </button>
          </div>

          {loading && jobs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading partnership forms
            </div>
          ) : jobs.length === 0 ? (
            <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0b2420] text-emerald-300">
                <Briefcase className="h-5 w-5" />
              </span>
              <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No partnership forms yet</p>
              <p className="m-0 mt-1 text-xs text-neutral-500">Open the first form so tour companies can apply.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border-0 border-t border-solid border-neutral-100">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead>
                  <tr className="text-[11px] font-semibold text-neutral-400">
                    <th className="px-4 py-2.5 font-semibold sm:pl-5">Form</th>
                    <th className="px-4 py-2.5 font-semibold">Stage</th>
                    <th className="px-4 py-2.5 font-semibold">Program owner</th>
                    <th className="px-4 py-2.5 font-semibold">Engagement</th>
                    <th className="px-4 py-2.5 font-semibold">Posted</th>
                    <th className="px-4 py-2.5 font-semibold">Closes</th>
                    <th className="px-4 py-2.5 sm:pr-5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const open = job.status === 'ACTIVE';
                    const stageText = open ? 'text-emerald-700' : job.status === 'CLOSED' ? 'text-neutral-500' : 'text-amber-700';
                    const stageDot = open ? 'bg-emerald-500' : job.status === 'CLOSED' ? 'bg-neutral-400' : 'bg-amber-500';
                    return (
                      <tr key={job.id} className="border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-neutral-50/70">
                        <td className="px-4 py-3 sm:pl-5">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#0b2420] text-emerald-300"><Handshake className="h-4 w-4" /></span>
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="max-w-[18rem] truncate font-medium text-neutral-900">{tidyName(job.title)}</span>
                                {job.featured && <span className="rounded-full border border-solid border-amber-100 bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-700">Featured</span>}
                              </div>
                              <div className="truncate text-xs text-neutral-400">{humanize(job.category)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${stageText}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${stageDot}`} /> {open ? 'Open' : humanize(job.status)}
                          </span>
                        </td>
                        <td className={`px-4 py-3 ${job.department ? 'text-neutral-700' : 'text-neutral-400'}`}>{job.department || 'Not set'}</td>
                        <td className="px-4 py-3 text-neutral-700">{humanize(job.type)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{formatDate(job.postedDate)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{job.applicationDeadline ? formatDate(job.applicationDeadline) : 'No deadline'}</td>
                        <td className="px-4 py-3 sm:pr-5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button type="button" onClick={() => setViewingJob(job)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"><Eye className="h-3.5 w-3.5" /> View</button>
                            <button type="button" onClick={() => handleEdit(job)} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800"><Edit className="h-3.5 w-3.5" /> Edit</button>
                            <button type="button" onClick={() => handleDelete(job.id)} aria-label={`Delete ${job.title}`} title="Delete" className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Application record, in the admin Sales record style */}
      {viewingApplication && (
        <ApplicationRecord
          application={viewingApplication}
          displayStatus={displayStatus}
          onClose={() => setViewingApplication(null)}
          updating={updatingStatus === viewingApplication.id}
          onChangeStatus={(status) => updateApplicationStatus(viewingApplication.id, status, viewingApplication.adminNotes)}
          notes={viewingApplication.adminNotes || ''}
          onNotesChange={(notes) => setViewingApplication({ ...viewingApplication, adminNotes: notes })}
          savingNotes={savingNotes}
          onSaveNotes={() => saveApplicationNotes(viewingApplication.id, viewingApplication.adminNotes || '')}
          contract={contractWorkflow}
          contractLoading={contractWorkflowLoading}
          contractAction={contractActionLoading}
          onPrepareContract={handlePrepareContractWorkflow}
          onSignContract={handleAdminSignContract}
          audit={auditTimeline}
          auditLoading={auditTimelineLoading}
          formatAuditAction={formatAuditAction}
          summarizeAuditEvent={summarizeAuditEvent}
          onViewDocument={() => handleViewResume(viewingApplication.id)}
          onDownloadDocument={() => downloadApplicationDocument(viewingApplication.id)}
        />
      )}

      {/* Application Document Viewer Modal */}
      {viewingResume && resumeViewUrl && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 p-4">
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

type ApplicationSortField = "companyContact" | "partnershipForm" | "status" | "submitted";
function initials(name?: string | null) {
  const parts = String(name || "").trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.charAt(0) || "") + (parts[1]?.charAt(0) || "")).toUpperCase() || "?";
}

function humanize(value?: string | null) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Not set";
}

/** Names typed in capitals ("NOTHERN CIRCUT PARTNERSHIP") read as Title Case in lists. */
function tidyName(value?: string | null) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}
