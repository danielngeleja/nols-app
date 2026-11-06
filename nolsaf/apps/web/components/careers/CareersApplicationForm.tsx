"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, Languages, Upload, X, XCircle } from "lucide-react";
import { REGIONS as TZ_REGIONS } from "@/lib/tzRegions";
import {
  COMMON_SERVICES,
  getServiceOptionsForTypes,
  TOOLS_ASSETS_OPTIONS,
  TOURISM_TYPE_SERVICES,
  TOURISM_TYPES,
  VEHICLE_SERVICE_MODES,
} from "@/components/careers/partnershipProfile";
import {
  AGENT_SPECIALIZATIONS,
  AGENT_SPECIALIZATION_VALUES,
  EAST_AFRICA_COUNTRIES,
  PINNED_NATIONALITIES,
  SOUTHERN_AFRICA_COUNTRIES,
} from "@nolsaf/shared";

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

export type CareersApplicationJob = {
  id: string;
  title: string;
  type: JobType;
  isTravelAgentPosition?: boolean;
};

type CareersApplicationFormProps = {
  job: CareersApplicationJob;
  onCloseAction: () => void;
  onSuccessAction?: () => void;
};

export default function CareersApplicationForm({ job, onCloseAction, onSuccessAction }: CareersApplicationFormProps) {
  const isTravelAgentPosition =
    Boolean((job as any).isTravelAgentPosition) ||
    ["PARTNERSHIP", "AGENCY_AGREEMENT", "RESELLER", "AFFILIATE", "WHITE_LABEL"].includes(
      String((job as any).type || "").toUpperCase(),
    );
  const ABOUT_MIN_WORDS = 60;
  const ABOUT_MAX_WORDS = 100;

  const countWords = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).filter(Boolean).length;
  };

  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    coverLetter: "",
    resume: null as File | null,
    portfolio: "",
    linkedIn: "",
    referredBy: "",
    companyName: "",
    businessAddress: "",
    companyEmail: "",
    companyPhone: "",
    companyWebsite: "",
    businessRegistrationNumber: "",
    tinNumber: "",
    businessLicenseNumber: "",
    tourismPermitNumber: "",
    vehiclePermitNumber: "",
    yearsInOperation: "",
    teamSize: "",
    tourismTypes: [] as string[],
    partnershipServices: [] as string[],
    toolsAndAssets: [] as string[],
    nationality: "",
    region: "",
    district: "",
    languages: [] as string[],
    specializations: [] as string[],
    certifications: [] as Array<{ name: string; issuer: string; year: string; expiryDate?: string }>,
    registeredParks: [] as string[],
    hasVehicles: false,
    vehicles: [] as Array<{
      type: string;
      count: number;
      capacity: number;
      ownership: "company_owned" | "rented" | "leased";
      condition?: string;
      registrationNumber?: string;
      serviceMode?: string;
    }>,
  });

  const [languageInput, setLanguageInput] = useState("");
  const [tourismTypeInput, setTourismTypeInput] = useState("");
  const [serviceCategoryInput, setServiceCategoryInput] = useState("");
  const [partnershipServiceInput, setPartnershipServiceInput] = useState("");
  const [serviceSelectionByCategory, setServiceSelectionByCategory] = useState<Record<string, string[]>>({});
  const [toolsAssetInput, setToolsAssetInput] = useState("");
  const [specializationInput, setSpecializationInput] = useState("");
  const [certInput, setCertInput] = useState({ name: "", issuer: "", year: "", expiryDate: "" });
  const [parkInput, setParkInput] = useState("");
  const [vehicleInput, setVehicleInput] = useState({
    type: "",
    count: "",
    capacity: "",
    ownership: "company_owned" as "company_owned" | "rented" | "leased",
    condition: "",
    registrationNumber: "",
    serviceMode: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [tourismSites, setTourismSites] = useState<{ id: number; name: string }[]>([]);
  const [tourismSitesLoading, setTourismSitesLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const travelFlowSteps = [
    "Company Details",
    "Tourism Serving",
    "Area of Operation",
    "Tools & Fleet",
    "Compliance & Submit",
  ];

  useEffect(() => {
    if (!isTravelAgentPosition) return;
    setTourismSitesLoading(true);
    const base = (process.env.NEXT_PUBLIC_API_URL as string) ?? "";
    const url = base ? base.replace(/\/$/, "") + "/api/public/tourism-sites" : "/api/public/tourism-sites";
    fetch(url)
      .then((r) => r.json())
      .then((data) => setTourismSites(Array.isArray(data.items) ? data.items : []))
      .catch(() => setTourismSites([]))
      .finally(() => setTourismSitesLoading(false));
  }, [isTravelAgentPosition]);

  const districtsForSelectedRegion = useMemo(() => {
    const selected = TZ_REGIONS.find((r) => r.name === formData.region);
    return selected?.districts ?? [];
  }, [formData.region]);

  const aboutWords = useMemo(() => countWords(formData.coverLetter), [formData.coverLetter]);
  const aboutTooShort = aboutWords > 0 && aboutWords < ABOUT_MIN_WORDS;
  const aboutTooLong = aboutWords > ABOUT_MAX_WORDS;
  const aboutInvalid = aboutWords < ABOUT_MIN_WORDS || aboutWords > ABOUT_MAX_WORDS;
  const serviceOptionsForCategory = useMemo(() => {
    if (!serviceCategoryInput) return [] as string[];
    if (serviceCategoryInput === "COMMON") return COMMON_SERVICES;
    return TOURISM_TYPE_SERVICES[serviceCategoryInput as keyof typeof TOURISM_TYPE_SERVICES] ?? [];
  }, [serviceCategoryInput]);

  const cleanedServiceClassification = useMemo(() => {
    const next: Record<string, string[]> = {};
    Object.entries(serviceSelectionByCategory).forEach(([category, services]) => {
      const cleaned = Array.from(new Set((services || []).map((s) => s.trim()).filter(Boolean))).filter((s) =>
        formData.partnershipServices.includes(s),
      );
      if (cleaned.length > 0) next[category] = cleaned;
    });
    return next;
  }, [serviceSelectionByCategory, formData.partnershipServices]);

  useEffect(() => {
    if (isTravelAgentPosition) setCurrentStep(0);
  }, [isTravelAgentPosition, job.id]);

  const validateTravelStep = (step: number): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (step === 0) {
      if (!formData.fullName || !formData.email || !formData.phone || !formData.nationality) {
        setError("Please complete contact person details first");
        return false;
      }
      if (!formData.companyName.trim() || !formData.businessAddress.trim() || !formData.companyPhone.trim()) {
        setError("Please complete company details first");
        return false;
      }
      if (formData.companyEmail.trim() && !emailRegex.test(formData.companyEmail.trim())) {
        setError("Please provide a valid company email");
        return false;
      }
      if (aboutInvalid) {
        setError(`Company narrative must be between ${ABOUT_MIN_WORDS} and ${ABOUT_MAX_WORDS} words.`);
        return false;
      }
      if (!Array.isArray(formData.languages) || formData.languages.length === 0) {
        setError("Please add at least one language your company can serve in");
        return false;
      }
    }
    if (step === 1) {
      if (formData.tourismTypes.length === 0 || formData.partnershipServices.length === 0) {
        setError("Please add at least one tourism type and one service");
        return false;
      }
      const typesWithoutServices = formData.tourismTypes.filter((type) => !cleanedServiceClassification[type]?.length);
      if (typesWithoutServices.length > 0) {
        setError(`Add at least one classified service for: ${typesWithoutServices.join(", ")}`);
        return false;
      }
      if (formData.specializations.length === 0) {
        setError("Please add at least one specialization");
        return false;
      }
    }
    if (step === 2) {
      if (!formData.region || !formData.district || formData.registeredParks.length === 0) {
        setError("Please set region, district, and at least one permitted park/site");
        return false;
      }
    }
    if (step === 3 && formData.hasVehicles && formData.vehicles.length === 0) {
      setError("Add at least one vehicle record or choose No vehicles");
      return false;
    }
    setError(null);
    return true;
  };

  const handleNextStep = () => {
    if (!validateTravelStep(currentStep)) return;
    setCurrentStep((prev) => Math.min(prev + 1, travelFlowSteps.length - 1));
  };

  const handleAddLanguage = () => {
    if (languageInput.trim() && !formData.languages.includes(languageInput.trim())) {
      setFormData({
        ...formData,
        languages: [...formData.languages, languageInput.trim()],
      });
      setLanguageInput("");
    }
  };

  const handleRemoveLanguage = (lang: string) => {
    setFormData({
      ...formData,
      languages: formData.languages.filter((l) => l !== lang),
    });
  };

  const handleAddPartnershipService = () => {
    const value = String(partnershipServiceInput || "").trim();
    if (!value) return;
    if (!serviceCategoryInput) {
      setError("Choose a service category first (Common or a Tourism Type)");
      return;
    }
    if (!serviceOptionsForCategory.includes(value)) {
      setError("Select a service that belongs to the chosen category");
      return;
    }
    if (formData.partnershipServices.includes(value)) {
      setPartnershipServiceInput("");
      return;
    }
    const categoryLabel = serviceCategoryInput === "COMMON" ? "Common Services" : serviceCategoryInput;
    setFormData({
      ...formData,
      partnershipServices: [...formData.partnershipServices, value],
    });
    setServiceSelectionByCategory((prev) => ({
      ...prev,
      [categoryLabel]: Array.from(new Set([...(prev[categoryLabel] || []), value])),
    }));
    setPartnershipServiceInput("");
    setError(null);
  };

  const handleAddTourismType = () => {
    const value = String(tourismTypeInput || "").trim();
    if (!value) return;
    if (formData.tourismTypes.includes(value)) {
      setTourismTypeInput("");
      return;
    }
    setFormData({
      ...formData,
      tourismTypes: [...formData.tourismTypes, value],
    });
    setTourismTypeInput("");
  };

  const handleRemoveTourismType = (value: string) => {
    const remainingTypes = formData.tourismTypes.filter((item) => item !== value);
    const remainingAllowedServices = getServiceOptionsForTypes(remainingTypes);
    setFormData({
      ...formData,
      tourismTypes: remainingTypes,
      partnershipServices: formData.partnershipServices.filter((s) => remainingAllowedServices.includes(s)),
    });
    setServiceSelectionByCategory((prev) => {
      const next = { ...prev };
      delete next[value];
      Object.keys(next).forEach((k) => {
        next[k] = next[k].filter((s) => remainingAllowedServices.includes(s));
        if (next[k].length === 0) delete next[k];
      });
      return next;
    });
    if (serviceCategoryInput === value) {
      setServiceCategoryInput("");
      setPartnershipServiceInput("");
    }
  };

  const handleAddToolsAsset = () => {
    const value = String(toolsAssetInput || "").trim();
    if (!value) return;
    if (formData.toolsAndAssets.includes(value)) {
      setToolsAssetInput("");
      return;
    }
    setFormData({
      ...formData,
      toolsAndAssets: [...formData.toolsAndAssets, value],
    });
    setToolsAssetInput("");
  };

  const handleRemoveToolsAsset = (value: string) => {
    setFormData({
      ...formData,
      toolsAndAssets: formData.toolsAndAssets.filter((item) => item !== value),
    });
  };

  const handleRemovePartnershipService = (value: string) => {
    setFormData({
      ...formData,
      partnershipServices: formData.partnershipServices.filter((item) => item !== value),
    });
    setServiceSelectionByCategory((prev) => {
      const next: Record<string, string[]> = {};
      Object.entries(prev).forEach(([category, services]) => {
        const filtered = services.filter((s) => s !== value);
        if (filtered.length > 0) next[category] = filtered;
      });
      return next;
    });
  };

  const handleAddSpecialization = () => {
    const candidate = String(specializationInput || "").trim();
    if (!candidate) return;
    if (!AGENT_SPECIALIZATION_VALUES.has(candidate)) {
      setError("Please select a specialization from the list");
      return;
    }
    if (formData.specializations.includes(candidate)) {
      setSpecializationInput("");
      return;
    }
    setFormData({
      ...formData,
      specializations: [...formData.specializations, candidate],
    });
    setSpecializationInput("");
  };

  const handleRemoveSpecialization = (spec: string) => {
    setFormData({
      ...formData,
      specializations: formData.specializations.filter((s) => s !== spec),
    });
  };

  const handleAddPark = () => {
    const val = parkInput.trim();
    if (!val || formData.registeredParks.includes(val)) {
      setParkInput("");
      return;
    }
    setFormData((prev) => ({ ...prev, registeredParks: [...prev.registeredParks, val] }));
    setParkInput("");
  };

  const handleRemovePark = (park: string) => {
    setFormData((prev) => ({ ...prev, registeredParks: prev.registeredParks.filter((p) => p !== park) }));
  };

  const handleAddVehicle = () => {
    const count = parseInt(vehicleInput.count, 10);
    const capacity = parseInt(vehicleInput.capacity, 10);
    if (!vehicleInput.type.trim() || isNaN(count) || count < 1 || isNaN(capacity) || capacity < 1) return;
    setFormData((prev) => ({
      ...prev,
      vehicles: [
        ...prev.vehicles,
        {
          type: vehicleInput.type.trim(),
          count,
          capacity,
          ownership: vehicleInput.ownership,
          condition: vehicleInput.condition.trim() || undefined,
          registrationNumber: vehicleInput.registrationNumber.trim() || undefined,
          serviceMode: vehicleInput.serviceMode.trim() || undefined,
        },
      ],
    }));
    setVehicleInput({
      type: "",
      count: "",
      capacity: "",
      ownership: "company_owned",
      condition: "",
      registrationNumber: "",
      serviceMode: "",
    });
  };

  const handleRemoveVehicle = (idx: number) => {
    setFormData((prev) => ({ ...prev, vehicles: prev.vehicles.filter((_, i) => i !== idx) }));
  };

  const handleAddCertification = () => {
    if (certInput.name.trim() && certInput.issuer.trim() && certInput.year.trim()) {
      setFormData({
        ...formData,
        certifications: [
          ...formData.certifications,
          {
            name: certInput.name.trim(),
            issuer: certInput.issuer.trim(),
            year: certInput.year.trim(),
            expiryDate: certInput.expiryDate.trim() || undefined,
          },
        ],
      });
      setCertInput({ name: "", issuer: "", year: "", expiryDate: "" });
    }
  };

  const handleRemoveCertification = (index: number) => {
    setFormData({
      ...formData,
      certifications: formData.certifications.filter((_, i) => i !== index),
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError("File size must be less than 5MB");
        return;
      }
      if (!file.type.includes("pdf") && !file.type.includes("doc") && !file.type.includes("docx")) {
        setError("Please upload a PDF or Word document");
        return;
      }
      setFormData({ ...formData, resume: file });
      setError(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Only a deliberate click on "Submit Application" sends the application.
    // Pressing Enter in a field, or any other path, must never submit early,
    // and a multi-step application only submits from its last step.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    if (submitter?.dataset.finalSubmit !== "true") return;
    if (isTravelAgentPosition && currentStep < travelFlowSteps.length - 1) return;
    setError(null);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!formData.fullName || !formData.email || !formData.phone || !formData.region || !formData.district || !formData.coverLetter) {
      setError("Please fill in all required fields");
      return;
    }

    if (!isTravelAgentPosition && !formData.linkedIn.trim()) {
      setError("Please fill in all required fields");
      return;
    }

    if (aboutInvalid) {
      setError(
        isTravelAgentPosition
          ? `Describe your company and your team must be between ${ABOUT_MIN_WORDS} and ${ABOUT_MAX_WORDS} words.`
          : `Tell us about yourself must be between ${ABOUT_MIN_WORDS} and ${ABOUT_MAX_WORDS} words.`,
      );
      return;
    }

    if (!formData.nationality.trim()) {
      setError("Please select nationality");
      return;
    }

    if (!Array.isArray(formData.languages) || formData.languages.length === 0) {
      setError("Please add at least one language you can speak/read/write");
      return;
    }

    if (!Array.isArray(formData.specializations) || formData.specializations.length === 0) {
      setError("Please add at least one specialization");
      return;
    }

    if (isTravelAgentPosition) {
      if (!formData.companyName.trim() || !formData.businessAddress.trim()) {
        setError("Please provide company name and business address");
        return;
      }
      if (formData.companyEmail.trim() && !emailRegex.test(formData.companyEmail.trim())) {
        setError("Please provide a valid company email");
        return;
      }
      const normalizedCompanyPhone = String(formData.companyPhone || "").trim();
      if (!normalizedCompanyPhone || !/^\+?[0-9]+$/.test(normalizedCompanyPhone)) {
        setError("Please provide a valid company phone (digits with optional +)");
        return;
      }
      if (!Array.isArray(formData.partnershipServices) || formData.partnershipServices.length === 0) {
        setError("Please add at least one partnership service");
        return;
      }
      if (!Array.isArray(formData.tourismTypes) || formData.tourismTypes.length === 0) {
        setError("Please add at least one tourism type");
        return;
      }
      if (!Array.isArray(formData.registeredParks) || formData.registeredParks.length === 0) {
        setError("Please select at least one park or tour site your company is permitted to operate in");
        return;
      }
    }

    setSubmitting(true);
    try {
      const base = (process.env.NEXT_PUBLIC_API_URL as string) ?? "";
      const url = base ? base.replace(/\/$/, "") + "/api/careers/apply" : "/api/careers/apply";

      const formDataToSend = new FormData();
      formDataToSend.append("jobId", job.id);
      formDataToSend.append("fullName", formData.fullName);
      formDataToSend.append("email", formData.email);
      formDataToSend.append("phone", formData.phone);
      formDataToSend.append("region", formData.region);
      formDataToSend.append("district", formData.district);
      formDataToSend.append("coverLetter", formData.coverLetter);
      if (formData.resume) {
        formDataToSend.append("resume", formData.resume);
      }
      if (!isTravelAgentPosition && formData.portfolio) formDataToSend.append("portfolio", formData.portfolio);
      if (!isTravelAgentPosition && formData.linkedIn) formDataToSend.append("linkedIn", formData.linkedIn);
      if (!isTravelAgentPosition && formData.referredBy) formDataToSend.append("referredBy", formData.referredBy);

      if (formData.nationality) formDataToSend.append("nationality", formData.nationality.trim());
      if (formData.languages.length > 0) formDataToSend.append("languages", JSON.stringify(formData.languages));

      const agentApplicationData = isTravelAgentPosition
        ? {
            nationality: formData.nationality.trim() || null,
            region: formData.region.trim() || null,
            district: formData.district.trim() || null,
            yearsOfExperience: null,
            bio: null,
            areasOfOperation: null,
            languages: formData.languages.length > 0 ? formData.languages : null,
            specializations: formData.specializations.length > 0 ? formData.specializations : null,
            certifications: formData.certifications.length > 0 ? formData.certifications : null,
            partnershipProfile: {
              companyName: formData.companyName.trim() || null,
              businessAddress: formData.businessAddress.trim() || null,
              companyEmail: formData.companyEmail.trim() || null,
              companyPhone: formData.companyPhone.trim() || null,
              companyWebsite: formData.companyWebsite.trim() || null,
              businessRegistrationNumber: formData.businessRegistrationNumber.trim() || null,
              tinNumber: formData.tinNumber.trim() || null,
              businessLicenseNumber: formData.businessLicenseNumber.trim() || null,
              tourismPermitNumber: formData.tourismPermitNumber.trim() || null,
              vehiclePermitNumber: formData.vehiclePermitNumber.trim() || null,
              yearsInOperation: formData.yearsInOperation ? parseInt(formData.yearsInOperation, 10) : null,
              teamSize: formData.teamSize ? parseInt(formData.teamSize, 10) : null,
              tourismTypes: formData.tourismTypes.length > 0 ? formData.tourismTypes : null,
              services: formData.partnershipServices.length > 0 ? formData.partnershipServices : null,
              serviceClassification: Object.keys(cleanedServiceClassification).length > 0 ? cleanedServiceClassification : null,
              toolsAndAssets: formData.toolsAndAssets.length > 0 ? formData.toolsAndAssets : null,
              registeredParks: formData.registeredParks.length > 0 ? formData.registeredParks : null,
              hasVehicles: Boolean(formData.hasVehicles),
              fleet: formData.hasVehicles && formData.vehicles.length > 0 ? formData.vehicles : null,
            },
          }
        : {
            specializations: formData.specializations.length > 0 ? formData.specializations : null,
          };
      formDataToSend.append("agentApplicationData", JSON.stringify(agentApplicationData));

      const response = await fetch(url, {
        method: "POST",
        body: formDataToSend,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccessAction?.();
        onCloseAction();
      }, 2000);
    } catch (err: any) {
      console.error("Application submission failed", err);
      setError(err?.message || "Failed to submit application. Please try again or email careers@nolsaf.com directly.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 text-center">
          <CheckCircle2 className="mx-auto mb-4 text-green-500" size={64} />
          <h3 className="text-2xl font-bold text-gray-900 mb-2">Application Submitted!</h3>
          <p className="text-gray-600 mb-6">
            Thank you for applying to {job.title}. We'll review your application and get back to you soon.
          </p>
          <button type="button"
            onClick={onCloseAction}
            className="w-full bg-[#02665e] text-white py-3 rounded-lg font-semibold hover:bg-[#024d47] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/70 p-3 pt-5 sm:items-center sm:p-4 overflow-y-auto overflow-x-hidden">
      <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[92dvh] overflow-y-auto overflow-x-hidden shadow-[0_24px_80px_rgba(2,102,94,0.28)] border border-slate-200">
        <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-slate-200 p-4 sm:p-6 flex items-center justify-between gap-4 z-20">
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-[#02665e] font-semibold">Partnership Application</p>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 break-words">Apply for {job.title}</h2>
          </div>
          <button type="button" onClick={onCloseAction} className="p-2 hover:bg-slate-100 rounded-full transition-colors flex-shrink-0 border border-slate-200">
            <X size={24} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          onKeyDown={(e) => {
            // Enter in a single-line field would submit the form; keep it for
            // the fields' own "add" handlers (they run first) and for textareas.
            const target = e.target as HTMLElement;
            if (e.key === "Enter" && target.tagName === "INPUT") e.preventDefault();
          }}
          className="p-4 sm:p-6 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-6 space-y-8 overflow-x-hidden bg-slate-50/60">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">{error}</div>}

          {isTravelAgentPosition && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Application Flow</p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 text-xs sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:p-0">
                {travelFlowSteps.map((step, idx) => (
                  <button type="button"
                    key={step}
                    onClick={() => setCurrentStep(idx)}
                    className={`group flex min-w-[8rem] flex-col items-center gap-1.5 rounded-2xl border px-2.5 py-3 transition-colors sm:min-w-0 ${
                      idx === currentStep
                        ? "border-[#02665e]/35 bg-[#02665e]/10 shadow-sm"
                        : idx < currentStep
                        ? "border-[#02665e]/20 bg-emerald-50/70"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      idx === currentStep
                        ? "bg-[#02665e] text-white"
                        : idx < currentStep
                        ? "bg-[#02665e]/20 text-[#02665e]"
                        : "bg-slate-200 text-slate-400"
                    }`}>{idx + 1}</span>
                    <span className={`max-w-full text-center text-[11px] font-semibold leading-tight sm:text-xs ${
                      idx === currentStep ? "text-[#02554e]" : "text-slate-400"
                    }`}>{step}</span>
                    <span className={`h-0.5 w-full rounded-full transition-colors ${
                      idx === currentStep ? "bg-[#02665e]" : idx < currentStep ? "bg-[#02665e]/30" : "bg-slate-200"
                    }`} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {isTravelAgentPosition && currentStep === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#02665e] text-white text-xs font-bold">1</span>
                <h3 className="text-base font-semibold text-slate-900">Company Details</h3>
              </div>
              <p className="text-sm text-slate-500 mt-0.5">Contact person, company information, and your company narrative.</p>
            </div>
          )}

          {(!isTravelAgentPosition || currentStep === 0) && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full box-border">
            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                placeholder="John Doe"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                placeholder="john@example.com"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                required
                inputMode="tel"
                pattern="^\+?[0-9]+$"
                title="Use digits only, optionally starting with +"
                value={formData.phone}
                onChange={(e) => {
                  const raw = e.target.value;
                  const hasPlus = raw.trim().startsWith("+");
                  const digitsOnly = raw.replace(/[^0-9]/g, "");
                  const normalized = (hasPlus ? "+" : "") + digitsOnly;
                  setFormData({ ...formData, phone: normalized.slice(0, 20) });
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                placeholder="+255123456789"
              />
            </div>

            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nationality <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.nationality}
                onChange={(e) => setFormData({ ...formData, nationality: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border bg-white"
              >
                <option value="">Select nationality...</option>
                <optgroup label="Top">
                  {PINNED_NATIONALITIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="East Africa">
                  {EAST_AFRICA_COUNTRIES.filter((c) => !PINNED_NATIONALITIES.some((p) => p.value === c.value)).map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Southern Africa">
                  {SOUTHERN_AFRICA_COUNTRIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {isTravelAgentPosition && (
              <>
                <div className="min-w-0 md:col-span-2 rounded-xl border border-[#02665e]/20 bg-[#02665e]/5 p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-[#02554e]">Partnership Company Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.companyName}
                        onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                        placeholder="e.g., Northern Circuit Tours Ltd"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Company Email (Optional)</label>
                      <input
                        type="email"
                        value={formData.companyEmail}
                        onChange={(e) => setFormData({ ...formData, companyEmail: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                        placeholder="partnerships@company.com"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Company Phone <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        value={formData.companyPhone}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const hasPlus = raw.trim().startsWith("+");
                          const digitsOnly = raw.replace(/[^0-9]/g, "");
                          const normalized = (hasPlus ? "+" : "") + digitsOnly;
                          setFormData({ ...formData, companyPhone: normalized.slice(0, 20) });
                        }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                        placeholder="+255712345678"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Company Website</label>
                      <input
                        type="url"
                        value={formData.companyWebsite}
                        onChange={(e) => setFormData({ ...formData, companyWebsite: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                        placeholder="https://yourcompany.com"
                      />
                    </div>

                    <div className="min-w-0 md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Business Address <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.businessAddress}
                        onChange={(e) => setFormData({ ...formData, businessAddress: e.target.value })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                        placeholder="Street, District, Region, Country"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Years in Operation</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={formData.yearsInOperation}
                        onChange={(e) => { if (/^\d*$/.test(e.target.value)) setFormData({ ...formData, yearsInOperation: e.target.value }); }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                        placeholder="e.g., 7"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Team Size</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={formData.teamSize}
                        onChange={(e) => { if (/^\d*$/.test(e.target.value)) setFormData({ ...formData, teamSize: e.target.value }); }}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                        placeholder="e.g., 25"
                      />
                    </div>
                  </div>
                </div>

              </>
            )}

            {!isTravelAgentPosition && (
              <div className="min-w-0 md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Specializations <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={specializationInput}
                    onChange={(e) => setSpecializationInput(e.target.value)}
                    className="min-w-0 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border bg-white"
                  >
                    <option value="">Select specialization</option>
                    {AGENT_SPECIALIZATIONS.map((spec) => {
                      const alreadySelected = formData.specializations.includes(spec);
                      return (
                        <option key={spec} value={spec} disabled={alreadySelected}>
                          {alreadySelected ? `${spec} (selected)` : spec}
                        </option>
                      );
                    })}
                  </select>
                  <button type="button"
                    onClick={handleAddSpecialization}
                    className="w-full px-4 py-2 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors sm:w-auto"
                  >
                    Add
                  </button>
                </div>
                {formData.specializations.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {formData.specializations.map((spec, idx) => (
                      <span key={idx} className={`inline-flex items-center justify-between gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm${spec.length > 22 ? " col-span-2" : ""}`}>
                        <span className="truncate">{spec}</span>
                        <button type="button" onClick={() => handleRemoveSpecialization(spec)} className="shrink-0 hover:text-green-900">
                          <XCircle className="h-4 w-4" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          </div>
          )}

          {(!isTravelAgentPosition || currentStep === 0) && (
          <div className="space-y-2 w-full box-border rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <Languages className="h-4 w-4 text-[#02665e]" />
              Languages (Speak / Read / Write) <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                list="language-options"
                value={languageInput}
                onChange={(e) => setLanguageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddLanguage();
                  }
                }}
                placeholder="Select or type a language (e.g., English)"
                className="min-w-0 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
              />
              <datalist id="language-options">
                {[
                  "Swahili",
                  "English",
                  "French",
                  "Arabic",
                  "Portuguese",
                  "Kinyarwanda",
                  "Kirundi",
                  "Luganda",
                  "Luo",
                  "Amharic",
                  "Somali",
                  "Afrikaans",
                  "Zulu",
                  "Shona",
                  "Ndebele",
                ].map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              <button type="button"
                onClick={handleAddLanguage}
                className="w-full px-4 py-2 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors sm:w-auto"
              >
                Add
              </button>
            </div>
            {formData.languages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.languages.map((lang, idx) => (
                  <span key={idx} className="inline-flex items-center gap-2 px-3 py-1 bg-purple-50 text-purple-700 rounded-lg text-sm">
                    {lang}
                    <button type="button" onClick={() => handleRemoveLanguage(lang)} className="hover:text-purple-900">
                      <XCircle className="h-4 w-4" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          )}

          {!isTravelAgentPosition && (
            <div className="w-full box-border">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Resume/CV <span className="text-red-500">*</span>
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg bg-gray-50/50 hover:bg-gray-50 hover:border-[#02665e] transition-all duration-200 w-full box-border">
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" onChange={handleFileChange} className="hidden" />
                {formData.resume ? (
                  <div className="flex items-center justify-center gap-3 p-4 sm:p-5">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[#02665e]/10">
                      <FileText className="text-[#02665e]" size={20} />
                    </div>
                    <span className="text-gray-700 font-medium text-sm sm:text-base flex-1 text-center truncate">{formData.resume.name}</span>
                    <button type="button"
                      onClick={() => {
                        setFormData({ ...formData, resume: null });
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="p-1.5 rounded-full hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors flex-shrink-0"
                      aria-label="Remove file"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ) : (
                  <button type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-3 p-6 sm:p-8 w-full text-gray-600 hover:text-[#02665e] transition-colors"
                  >
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border-2 border-gray-300 hover:border-[#02665e] transition-colors">
                      <Upload size={20} className="text-gray-500" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm sm:text-base font-medium">Click to upload or drag and drop</p>
                      <p className="text-xs sm:text-sm text-gray-500">PDF, DOC, DOCX (Max 5MB)</p>
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}

          {(!isTravelAgentPosition || currentStep === 0) && (
          <div className="w-full box-border rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {isTravelAgentPosition ? "Describe your company and your team" : "Tell us about yourself"} <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              value={formData.coverLetter}
              onChange={(e) => setFormData({ ...formData, coverLetter: e.target.value })}
              rows={6}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border resize-none ${
                aboutTooLong ? "border-red-300" : aboutTooShort ? "border-amber-300" : "border-gray-300"
              }`}
              placeholder={
                isTravelAgentPosition
                  ? "Describe your company background, team strength, operations, and what value your partnership brings..."
                  : "Share a short summary about you, what you have accomplished, and what you can bring to this role..."
              }
            />
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className={`font-medium ${aboutTooLong ? "text-red-600" : aboutTooShort ? "text-amber-700" : "text-gray-500"}`}>
                {ABOUT_MIN_WORDS}-{ABOUT_MAX_WORDS} words
              </span>
              <span className={`${aboutTooLong ? "text-red-600" : "text-gray-500"}`}>
                {aboutWords}/{ABOUT_MAX_WORDS}
              </span>
            </div>
          </div>
          )}

          {isTravelAgentPosition && currentStep === 1 && (
          <div className="w-full box-border rounded-2xl border border-sky-200 bg-sky-50/60 p-4 sm:p-5 space-y-4">
            <div className="mb-1">
              <h3 className="text-base font-semibold text-sky-900">Tourism Serving</h3>
              <p className="text-sm text-slate-500 mt-0.5">Classify the tourism types you serve, your categorised services, and your specializations.</p>
            </div>

            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tourism Types <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-gray-500 mb-2">Select the tourism categories your company serves.</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={tourismTypeInput}
                  onChange={(e) => setTourismTypeInput(e.target.value)}
                  className="min-w-0 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border bg-white"
                >
                  <option value="">Select tourism type</option>
                  {TOURISM_TYPES.map((tourismType) => {
                    const alreadySelected = formData.tourismTypes.includes(tourismType);
                    return (
                      <option key={tourismType} value={tourismType} disabled={alreadySelected}>
                        {alreadySelected ? `${tourismType} (selected)` : tourismType}
                      </option>
                    );
                  })}
                </select>
                <button type="button"
                  onClick={handleAddTourismType}
                  className="w-full px-4 py-2 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors sm:w-auto"
                >
                  Add
                </button>
              </div>
              {formData.tourismTypes.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {formData.tourismTypes.map((tourismType) => (
                    <span
                      key={tourismType}
                      className={`inline-flex items-center justify-between gap-1 px-3 py-1.5 bg-sky-100 text-sky-800 rounded-lg text-sm${tourismType.length > 22 ? " col-span-2" : ""}`}
                    >
                      <span className="truncate">{tourismType}</span>
                      <button type="button" onClick={() => handleRemoveTourismType(tourismType)} className="shrink-0 hover:text-sky-900">
                        <XCircle className="h-4 w-4" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Your Company Services <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-gray-500 mb-2">
                Services are classified by category. Choose a tourism type (or common services), then choose the matching service.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <select
                  value={serviceCategoryInput}
                  onChange={(e) => {
                    setServiceCategoryInput(e.target.value);
                    setPartnershipServiceInput("");
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border bg-white"
                >
                  <option value="">Select service category</option>
                  <option value="COMMON">Common Services</option>
                  {formData.tourismTypes.map((tourismType) => (
                    <option key={tourismType} value={tourismType}>
                      {tourismType}
                    </option>
                  ))}
                </select>
                <select
                  value={partnershipServiceInput}
                  onChange={(e) => setPartnershipServiceInput(e.target.value)}
                  disabled={!serviceCategoryInput}
                  className="md:col-span-2 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border bg-white disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">{serviceCategoryInput ? "Select a service" : "Choose category first"}</option>
                  {serviceOptionsForCategory.map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2">
                <button type="button"
                  onClick={handleAddPartnershipService}
                  className="px-4 py-2 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors"
                >
                  Add
                </button>
              </div>
              {Object.keys(cleanedServiceClassification).length > 0 && (
                <div className="space-y-3 mt-3">
                  {Object.entries(cleanedServiceClassification).map(([category, services]) => (
                    <div key={category} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">{category}</p>
                      <div className="grid grid-cols-2 gap-2">
                        {services.map((service) => (
                          <span
                            key={`${category}:${service}`}
                            className={`inline-flex items-center justify-between gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm${service.length > 22 ? " col-span-2" : ""}`}
                          >
                            <span className="truncate">{service}</span>
                            <button type="button"
                              onClick={() => handleRemovePartnershipService(service)}
                              className="shrink-0 hover:text-emerald-900"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {formData.partnershipServices.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-slate-500">Total selected services: {formData.partnershipServices.length}</p>
                </div>
              )}
              {formData.partnershipServices.length > 0 && Object.keys(cleanedServiceClassification).length === 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.partnershipServices.map((service) => (
                    <span key={service} className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-sm">
                      {service}
                      <button type="button"
                        onClick={() => handleRemovePartnershipService(service)}
                        className="hover:text-emerald-900"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Specializations <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={specializationInput}
                  onChange={(e) => setSpecializationInput(e.target.value)}
                  className="min-w-0 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border bg-white"
                >
                  <option value="">Select specialization</option>
                  {AGENT_SPECIALIZATIONS.map((spec) => {
                    const alreadySelected = formData.specializations.includes(spec);
                    return (
                      <option key={spec} value={spec} disabled={alreadySelected}>
                        {alreadySelected ? `${spec} (selected)` : spec}
                      </option>
                    );
                  })}
                </select>
                <button type="button"
                  onClick={handleAddSpecialization}
                  className="w-full px-4 py-2 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors sm:w-auto"
                >
                  Add
                </button>
              </div>
              {formData.specializations.length > 0 && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {formData.specializations.map((spec, idx) => (
                    <span key={idx} className={`inline-flex items-center justify-between gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm${spec.length > 22 ? " col-span-2" : ""}`}>
                      <span className="truncate">{spec}</span>
                      <button type="button" onClick={() => handleRemoveSpecialization(spec)} className="shrink-0 hover:text-green-900">
                        <XCircle className="h-4 w-4" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}

          {!isTravelAgentPosition && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full box-border">
              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  LinkedIn Profile <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  required
                  value={formData.linkedIn}
                  onChange={(e) => setFormData({ ...formData, linkedIn: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                  placeholder="https://linkedin.com/in/yourprofile"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-2">Portfolio/Website (Optional)</label>
                <input
                  type="url"
                  value={formData.portfolio}
                  onChange={(e) => setFormData({ ...formData, portfolio: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                  placeholder="https://yourportfolio.com"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-2">Referred By (Optional)</label>
                <input
                  type="text"
                  value={formData.referredBy}
                  onChange={(e) => setFormData({ ...formData, referredBy: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border"
                  placeholder="Name of employee who referred you"
                />
              </div>
            </div>
          )}

          {isTravelAgentPosition && (
            <div className="space-y-5">
              {currentStep === 2 && (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Area Of Operation</h3>
                    <p className="text-sm text-gray-500 mt-1">Set your company base and district before selecting permitted parks and sites.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Region <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={formData.region}
                        onChange={(e) => setFormData({ ...formData, region: e.target.value, district: "" })}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border bg-white"
                      >
                        <option value="">Select region...</option>
                        {TZ_REGIONS.map((r) => (
                          <option key={r.id} value={r.name}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        District <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={formData.district}
                        onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                        disabled={!formData.region}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border disabled:bg-gray-50 disabled:text-gray-400"
                      >
                        <option value="">{formData.region ? "Select district..." : "Select region first"}</option>
                        {districtsForSelectedRegion.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Permitted Parks &amp; Tour Sites <span className="text-red-500">*</span>
                  </h3>
                  <p className="text-sm text-gray-500">Select all parks and tour sites your company is permitted to operate in.</p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                    <select
                      value={parkInput}
                      onChange={(e) => setParkInput(e.target.value)}
                      disabled={tourismSitesLoading}
                      className="min-w-0 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent bg-white text-gray-700 text-sm box-border"
                    >
                      <option value="">{tourismSitesLoading ? "Loading..." : "Select a permitted park or tour site"}</option>
                      {tourismSites
                        .filter((s) => !formData.registeredParks.includes(s.name))
                        .map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                    <button type="button"
                      onClick={handleAddPark}
                      disabled={!parkInput}
                      className="flex h-11 w-full items-center justify-center px-5 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors disabled:opacity-40 disabled:cursor-not-allowed sm:w-auto"
                    >
                      Add
                    </button>
                  </div>
                  {formData.registeredParks.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {formData.registeredParks.map((park, idx) => (
                        <span key={idx} className={`inline-flex items-center justify-between gap-1 px-3 py-1.5 bg-green-50 text-green-800 rounded-lg text-sm border border-green-200${park.length > 22 ? " col-span-2" : ""}`}>
                          <span className="truncate">{park}</span>
                          <button type="button" onClick={() => handleRemovePark(park)} className="shrink-0 hover:text-red-600">
                            <XCircle className="h-4 w-4" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </>
              )}

              {currentStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Tools &amp; Assets</h3>
                <p className="text-sm text-gray-500">Tell us what you use to support your tours and activities.</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    value={toolsAssetInput}
                    onChange={(e) => setToolsAssetInput(e.target.value)}
                    className="min-w-0 flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border bg-white"
                  >
                    <option value="">Select tool or asset</option>
                    {TOOLS_ASSETS_OPTIONS.map((tool) => (
                      <option key={tool} value={tool}>
                        {tool}
                      </option>
                    ))}
                  </select>
                  <button type="button"
                    onClick={handleAddToolsAsset}
                    className="w-full px-4 py-2 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors sm:w-auto"
                  >
                    Add
                  </button>
                </div>
                {formData.toolsAndAssets.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {formData.toolsAndAssets.map((tool) => (
                      <span key={tool} className={`inline-flex items-center justify-between gap-1 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-sm border border-indigo-200${tool.length > 22 ? " col-span-2" : ""}`}>
                        <span className="truncate">{tool}</span>
                        <button type="button" onClick={() => handleRemoveToolsAsset(tool)} className="shrink-0 hover:text-indigo-900">
                          <XCircle className="h-4 w-4" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              )}

              {currentStep === 3 && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Fleet &amp; Vehicles</h3>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-700">Does your company have vehicles for tours?</span>
                  <div className="flex gap-3">
                    <button type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, hasVehicles: true }))}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        formData.hasVehicles
                          ? "bg-[#02665e] border-[#02665e] text-white"
                          : "bg-white border-gray-300 text-gray-700 hover:border-[#02665e]"
                      }`}
                    >
                      Yes
                    </button>
                    <button type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, hasVehicles: false, vehicles: [] }))}
                      className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        !formData.hasVehicles
                          ? "bg-gray-200 border-gray-300 text-gray-700"
                          : "bg-white border-gray-300 text-gray-700 hover:border-gray-400"
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                {formData.hasVehicles && (
                  <div className="space-y-4">
                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">
                            Vehicle Type <span className="text-red-500">*</span>
                          </label>
                          <select
                            value={vehicleInput.type}
                            onChange={(e) => setVehicleInput((v) => ({ ...v, type: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent bg-white text-sm box-border"
                          >
                            <option value="">Select type</option>
                            <option>4x4 Safari Land Cruiser</option>
                            <option>Safari Land Rover</option>
                            <option>Safari Pop-up Roof Minibus</option>
                            <option>Safari Van</option>
                            <option>Luxury Sedan / SUV</option>
                            <option>Coaster Bus</option>
                            <option>Microbus / Minivan</option>
                            <option>Pickup Truck</option>
                            <option>Boat / Water Vessel</option>
                            <option>Helicopter / Light Aircraft</option>
                            <option>Bicycle / E-Bike</option>
                            <option>Other</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">
                            Ownership <span className="text-red-500">*</span>
                          </label>
                          <select
                            value={vehicleInput.ownership}
                            onChange={(e) => setVehicleInput((v) => ({ ...v, ownership: e.target.value as any }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent bg-white text-sm box-border"
                          >
                            <option value="company_owned">Company Owned</option>
                            <option value="rented">Rented</option>
                            <option value="leased">Leased</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">
                            Number of Vehicles <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={vehicleInput.count}
                            onChange={(e) => setVehicleInput((v) => ({ ...v, count: e.target.value }))}
                            placeholder="e.g. 3"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent text-sm box-border"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">
                            Capacity per Vehicle (people) <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={vehicleInput.capacity}
                            onChange={(e) => setVehicleInput((v) => ({ ...v, capacity: e.target.value }))}
                            placeholder="e.g. 7"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent text-sm box-border"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="text-xs font-medium text-gray-600 mb-1 block">
                            Condition / Notes <span className="text-gray-400">(optional)</span>
                          </label>
                          <input
                            type="text"
                            value={vehicleInput.condition}
                            onChange={(e) => setVehicleInput((v) => ({ ...v, condition: e.target.value }))}
                            placeholder="e.g. 2022 model, well-maintained, roof hatch"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent text-sm box-border"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">Registration Number</label>
                          <input
                            type="text"
                            value={vehicleInput.registrationNumber}
                            onChange={(e) => setVehicleInput((v) => ({ ...v, registrationNumber: e.target.value }))}
                            placeholder="e.g. T123 ABC"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent text-sm box-border"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-gray-600 mb-1 block">Service Mode</label>
                          <select
                            value={vehicleInput.serviceMode}
                            onChange={(e) => setVehicleInput((v) => ({ ...v, serviceMode: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent bg-white text-sm box-border"
                          >
                            <option value="">Select mode</option>
                            {VEHICLE_SERVICE_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <button type="button"
                        onClick={handleAddVehicle}
                        disabled={!vehicleInput.type || !vehicleInput.count || !vehicleInput.capacity}
                        className="px-4 py-2 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Add Vehicle
                      </button>
                    </div>

                    {formData.vehicles.length > 0 && (
                      <div className="space-y-2">
                        {formData.vehicles.map((v, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <div>
                              <div className="font-medium text-blue-900 text-sm">{v.type}</div>
                              <div className="text-xs text-blue-700 mt-0.5">
                                {v.count} vehicle{v.count !== 1 ? "s" : ""} &bull; {v.capacity} seat{v.capacity !== 1 ? "s" : ""} each &bull;{" "}
                                {v.ownership === "company_owned" ? "Company Owned" : v.ownership === "rented" ? "Rented" : "Leased"}
                                {v.registrationNumber ? ` • Reg: ${v.registrationNumber}` : ""}
                                {v.serviceMode ? ` • Mode: ${v.serviceMode}` : ""}
                                {v.condition && ` · ${v.condition}`}
                              </div>
                            </div>
                            <button type="button" onClick={() => handleRemoveVehicle(idx)} className="text-red-500 hover:text-red-700 ml-3 flex-shrink-0">
                              <XCircle className="h-5 w-5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              {currentStep === 4 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Company Licenses & Certifications</h3>
                <div className="space-y-3 p-4 bg-emerald-50/50 rounded-xl border border-emerald-200">
                  <p className="text-sm font-medium text-emerald-900">Regulatory Compliance Identifiers</p>
                  <p className="text-xs text-emerald-800">Provide official registration and permit numbers (including BRELA) for verification.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-700 mb-1">BRELA / Business Registration Number</label>
                      <input
                        type="text"
                        value={formData.businessRegistrationNumber}
                        onChange={(e) => setFormData({ ...formData, businessRegistrationNumber: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm bg-white"
                        placeholder="e.g. 123456"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-700 mb-1">TIN Number</label>
                      <input
                        type="text"
                        value={formData.tinNumber}
                        onChange={(e) => setFormData({ ...formData, tinNumber: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm bg-white"
                        placeholder="Tax Identification Number"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-700 mb-1">Business License Number</label>
                      <input
                        type="text"
                        value={formData.businessLicenseNumber}
                        onChange={(e) => setFormData({ ...formData, businessLicenseNumber: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm bg-white"
                        placeholder="Municipal/Business License"
                      />
                    </div>

                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-700 mb-1">Tourism Permit Number</label>
                      <input
                        type="text"
                        value={formData.tourismPermitNumber}
                        onChange={(e) => setFormData({ ...formData, tourismPermitNumber: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm bg-white"
                        placeholder="Tourism board / authority permit"
                      />
                    </div>

                    <div className="min-w-0 md:col-span-2">
                      <label className="block text-xs font-medium text-gray-700 mb-1">Vehicle Permit Number</label>
                      <input
                        type="text"
                        value={formData.vehiclePermitNumber}
                        onChange={(e) => setFormData({ ...formData, vehiclePermitNumber: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm bg-white"
                        placeholder="Commercial / tourism vehicle permit"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <p className="text-sm text-gray-500">Add compliance records one by one to strengthen your approval review.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-600 mb-1">License/Certification Name</label>
                      <input
                        type="text"
                        value={certInput.name}
                        onChange={(e) => setCertInput({ ...certInput, name: e.target.value })}
                        placeholder="License/Certification name"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Issuing Authority</label>
                      <input
                        type="text"
                        value={certInput.issuer}
                        onChange={(e) => setCertInput({ ...certInput, issuer: e.target.value })}
                        placeholder="Issuing authority"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Year Issued</label>
                      <input
                        type="text"
                        value={certInput.year}
                        onChange={(e) => setCertInput({ ...certInput, year: e.target.value })}
                        placeholder="Year issued"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Date (Optional)</label>
                      <input
                        type="text"
                        value={certInput.expiryDate}
                        onChange={(e) => setCertInput({ ...certInput, expiryDate: e.target.value })}
                        placeholder="Expiry date (optional)"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-transparent box-border text-sm"
                      />
                    </div>
                  </div>
                  <button type="button"
                    onClick={handleAddCertification}
                    className="inline-flex px-4 py-2 bg-[#02665e] text-white rounded-lg text-sm font-medium hover:bg-[#014d47] transition-colors"
                  >
                    Add Record
                  </button>
                </div>
                {formData.certifications.length > 0 && (
                  <div className="space-y-2">
                    {formData.certifications.map((cert, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <div>
                          <div className="font-medium text-amber-900">{cert.name}</div>
                          <div className="text-sm text-amber-700">
                            {cert.issuer} • {cert.year}
                            {cert.expiryDate && ` • Expires: ${cert.expiryDate}`}
                          </div>
                        </div>
                        <button type="button" onClick={() => handleRemoveCertification(idx)} className="text-red-500 hover:text-red-700">
                          <XCircle className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>
          )}

          <div className="-mx-4 grid w-auto grid-cols-2 gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-16px_36px_rgba(15,23,42,0.08)] backdrop-blur sm:sticky sm:bottom-0 sm:-mx-6 sm:flex sm:flex-row sm:gap-4 sm:px-6">
            <button type="button"
              onClick={onCloseAction}
              className={`w-full px-4 sm:px-6 py-2.5 sm:py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors min-w-0 sm:flex-1 ${
                isTravelAgentPosition && currentStep > 0 ? "col-span-2 sm:col-span-1" : ""
              }`}
            >
              Cancel
            </button>
            {isTravelAgentPosition ? (
              <>
                {currentStep > 0 && (
                  <button type="button"
                    onClick={() => setCurrentStep((prev) => Math.max(prev - 1, 0))}
                    className="w-full px-4 sm:px-6 py-2.5 sm:py-3 border border-slate-300 text-slate-700 rounded-lg font-semibold hover:bg-slate-100 transition-colors min-w-0 sm:flex-1"
                  >
                    Back
                  </button>
                )}
                {/* Distinct keys: without them React reuses one <button> and flips it to
                    type="submit" during the "Next Step" click, which submitted the form
                    the moment the last step opened. */}
                {currentStep < travelFlowSteps.length - 1 ? (
                  <button type="button"
                    key="next-step"
                    onClick={handleNextStep}
                    className="w-full px-4 sm:px-6 py-2.5 sm:py-3 bg-[#02665e] text-white rounded-lg font-semibold hover:bg-[#024d47] transition-colors min-w-0 sm:flex-1"
                  >
                    Next Step
                  </button>
                ) : (
                  <button type="submit"
                    key="final-submit"
                    data-final-submit="true"
                    disabled={submitting || aboutInvalid}
                    className="w-full px-4 sm:px-6 py-2.5 sm:py-3 bg-[#02665e] text-white rounded-lg font-semibold hover:bg-[#024d47] transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-0 sm:flex-1"
                  >
                    {submitting ? "Submitting..." : "Submit Application"}
                  </button>
                )}
              </>
            ) : (
              <button type="submit"
                data-final-submit="true"
                disabled={submitting || aboutInvalid}
                className="w-full px-4 sm:px-6 py-2.5 sm:py-3 bg-[#02665e] text-white rounded-lg font-semibold hover:bg-[#024d47] transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-0 sm:flex-1"
              >
                {submitting ? "Submitting..." : "Submit Application"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
