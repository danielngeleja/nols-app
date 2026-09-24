"use client";
import { useEffect, useState, useRef } from "react";
import { AlertTriangle, Award, Plus, Edit, Trash2, Image as ImageIcon, ExternalLink, X, Loader2, Upload, Link2, Hash, Eye, EyeOff, Camera } from "lucide-react";
import axios from "axios";import apiClient from "@/lib/apiClient";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;
function authify() {}

// Helper to get API path with /api prefix
function getApiPath(path: string): string {
  return path.startsWith('/api/') ? path : `/api${path}`;
}

type TrustPartner = {
  id: number;
  name: string;
  logoUrl: string | null;
  href: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function replaceWithLogoPlaceholder(parent: HTMLElement) {
  try {
    parent.replaceChildren();

    const wrap = document.createElement("div");
    wrap.className = "h-full w-full bg-gray-100 rounded flex items-center justify-center";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "h-6 w-6 text-gray-400");
    svg.setAttribute("fill", "none");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("stroke", "currentColor");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-width", "2");
    path.setAttribute(
      "d",
      "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
    );
    svg.appendChild(path);
    wrap.appendChild(svg);
    parent.appendChild(wrap);
  } catch {
    // ignore
  }
}

function replaceWithInvalidImageText(parent: HTMLElement) {
  try {
    parent.replaceChildren();
    const wrap = document.createElement("div");
    wrap.className = "h-full w-full flex items-center justify-center text-red-500 text-xs";
    wrap.textContent = "Invalid image";
    parent.appendChild(wrap);
  } catch {
    // ignore
  }
}

export default function AdminTrustPartnersPage() {
  const [partners, setPartners] = useState<TrustPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<TrustPartner | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrustPartner | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: "",
    logoUrl: "",
    href: "",
    displayOrder: 0,
    isActive: true,
  });

  async function load() {
    setLoading(true);
    try {
      authify();
      const r = await api.get<{ items: TrustPartner[] }>(getApiPath("/admin/trust-partners"));
      setPartners(r.data?.items ?? []);
    } catch (err) {
      console.error("Failed to load trust partners", err);
      setPartners([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const handleOpenModal = (partner?: TrustPartner) => {
    if (partner) {
      setEditingPartner(partner);
      setFormData({
        name: partner.name,
        logoUrl: partner.logoUrl || "",
        href: partner.href || "",
        displayOrder: partner.displayOrder,
        isActive: partner.isActive,
      });
    } else {
      setEditingPartner(null);
      setFormData({
        name: "",
        logoUrl: "",
        href: "",
        displayOrder: partners.length,
        isActive: true,
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingPartner(null);
    setFormData({
      name: "",
      logoUrl: "",
      href: "",
      displayOrder: 0,
      isActive: true,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      authify();
      if (editingPartner) {
        await api.patch(getApiPath(`/admin/trust-partners/${editingPartner.id}`), formData);
      } else {
        await api.post(getApiPath("/admin/trust-partners"), formData);
      }
      await load();
      handleCloseModal();
    } catch (err: any) {
      console.error("Failed to save trust partner", err);
      alert(err.response?.data?.error || "Failed to save trust partner");
    } finally {
      setSubmitting(false);
    }
  };

  const requestDelete = (partner: TrustPartner) => {
    setDeleteTarget(partner);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      authify();
      await api.delete(getApiPath(`/admin/trust-partners/${deleteTarget.id}`));
      await load();
      setDeleteTarget(null);
    } catch (err: any) {
      console.error("Failed to delete trust partner", err);
      alert(err.response?.data?.error || "Failed to delete trust partner");
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (partner: TrustPartner) => {
    try {
      authify();
      await api.patch(getApiPath(`/admin/trust-partners/${partner.id}`), {
        isActive: !partner.isActive,
      });
      await load();
    } catch (err: any) {
      console.error("Failed to toggle partner status", err);
      alert(err.response?.data?.error || "Failed to update partner status");
    }
  };

  // Upload logo to Cloudinary
  const handleLogoUpload = async (file: File) => {
    setUploadingLogo(true);
    try {
      authify();
      // 1) Get Cloudinary signature from our API (requires auth)
      let sigData: any;
      try {
        // Use `/api/*` so Next rewrites proxy to the API server and cookies/session auth apply.
        const sig = await api.get(getApiPath(`/uploads/cloudinary/sign?folder=trust-partners`));
        sigData = sig.data;
      } catch (err: any) {
        console.error("Failed to get Cloudinary signature", err);
        const msg = err?.response?.data?.error || err?.response?.data?.message || err?.message || "Unauthorized";
        alert(`Failed to get upload signature (${err?.response?.status ?? "?"}). ${msg}`);
        return;
      }

      // Create form data for Cloudinary
      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", sigData.apiKey);
      fd.append("timestamp", String(sigData.timestamp));
      fd.append("folder", sigData.folder);
      // Must match the signed params on the server (see apps/api/src/routes/uploads.cloudinary.ts)
      fd.append("overwrite", "true");
      fd.append("signature", sigData.signature);

      // 2) Upload to Cloudinary (does NOT use our session cookies)
      let uploadRes: any;
      try {
        uploadRes = await axios.post(`https://api.cloudinary.com/v1_1/${sigData.cloudName}/auto/upload`, fd);
      } catch (err: any) {
        console.error("Cloudinary upload failed", err);
        const cloudMsg =
          err?.response?.data?.error?.message ||
          err?.response?.data?.error ||
          err?.response?.data?.message ||
          err?.message ||
          "Upload failed";
        alert(`Cloudinary upload failed (${err?.response?.status ?? "?"}). ${cloudMsg}`);
        return;
      }

      const uploadedUrl = uploadRes.data.secure_url;
      setFormData({ ...formData, logoUrl: uploadedUrl });
    } catch (err: any) {
      console.error("Failed to upload logo", err);
      alert(err.response?.data?.error || "Failed to upload logo. Please try again.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert("Please select an image file (PNG, JPG, etc.)");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("Image size must be less than 5MB");
      return;
    }

    handleLogoUpload(file);
  };

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center">
              <Award className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Trust Partners</h1>
              <p className="text-sm text-gray-500 mt-1">Manage partners displayed in the "Trusted by" section</p>
            </div>
          </div>
          <button
            onClick={() => handleOpenModal()}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Partner
          </button>
        </div>
      </div>

      {/* Partners List */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-emerald-600"></div>
            <p className="mt-3 text-sm text-gray-500">Loading partners...</p>
          </div>
        ) : partners.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <Award className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-900 mb-1">No trust partners yet</p>
            <p className="text-xs text-gray-500 mb-4">Get started by adding your first trust partner</p>
            <button
              onClick={() => handleOpenModal()}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2 mx-auto"
            >
              <Plus className="h-4 w-4" />
              Add Your First Partner
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                      <Hash className="h-4 w-4" />
                      Order
                    </div>
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      Logo
                    </div>
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Partner Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      Website
                    </div>
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {partners.map((partner, index) => (
                  <tr 
                    key={partner.id} 
                    className={`hover:bg-emerald-50/30 transition-all duration-150 ${
                      index % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                    }`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold">
                          {partner.displayOrder}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {partner.logoUrl ? (
                        <div className="group relative">
                          {partner.href ? (
                            <a
                              href={partner.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block"
                            >
                              <div className="h-16 w-40 bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-center hover:border-emerald-500 transition-colors">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={partner.logoUrl}
                                  alt={`${partner.name} logo`}
                                  className="h-full w-full object-contain"
                                  style={{ maxHeight: "100%", maxWidth: "100%" }}
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                    const parent = (e.target as HTMLImageElement).parentElement;
                                    if (parent) replaceWithLogoPlaceholder(parent);
                                  }}
                                />
                              </div>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                                {partner.name}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                              </div>
                            </a>
                          ) : (
                            <div className="relative">
                              <div className="h-16 w-40 bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={partner.logoUrl}
                                  alt={`${partner.name} logo`}
                                  className="h-full w-full object-contain"
                                  style={{ maxHeight: "100%", maxWidth: "100%" }}
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                    const parent = (e.target as HTMLImageElement).parentElement;
                                    if (parent) replaceWithLogoPlaceholder(parent);
                                  }}
                                />
                              </div>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                                {partner.name}
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="h-16 w-40 bg-gray-100 border border-gray-200 rounded-lg flex items-center justify-center">
                          <ImageIcon className="h-5 w-5 text-gray-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">{partner.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {partner.href ? (
                        <a
                          href={partner.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-emerald-600 hover:text-emerald-700 flex items-center gap-1.5 group max-w-xs"
                        >
                          <span className="truncate text-sm">{partner.href.replace(/^https?:\/\//, '')}</span>
                          <ExternalLink className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                      ) : (
                        <span className="text-sm text-gray-400 italic">No website link</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => handleToggleActive(partner)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
                          partner.isActive
                            ? "bg-green-100 text-green-700 hover:bg-green-200 shadow-sm"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      >
                        {partner.isActive ? (
                          <>
                            <Eye className="h-3.5 w-3.5" />
                            Active
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3.5 w-3.5" />
                            Inactive
                          </>
                        )}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleOpenModal(partner)}
                          className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit Partner"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => requestDelete(partner)}
                          disabled={deletingId === partner.id}
                          className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Delete Partner"
                        >
                          {deletingId === partner.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
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

      {/* Add/Edit Modal */}
      {showModal && (
        <>
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50" onClick={handleCloseModal} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              {/* Modal Header */}
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingPartner ? "Edit Trust Partner" : "Add Trust Partner"}
                </h2>
                <button
                  onClick={handleCloseModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              {/* Modal Body */}
              <form id="trust-partner-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
                <div className="space-y-4">
                  {/* Partner Name */}
                  <div className="w-full">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Partner Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm box-border"
                      placeholder="e.g., M-Pesa, Airtel Money"
                    />
                  </div>

                  {/* Logo Upload */}
                  <div className="w-full">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Logo
                    </label>
                    <div className="space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <div className="flex items-start gap-4">
                        {/* Upload Button */}
                        <div className="flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploadingLogo}
                            className="px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-emerald-500 hover:bg-emerald-50 transition-colors flex items-center gap-2 text-sm font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {uploadingLogo ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Camera className="h-4 w-4" />
                                Upload Logo
                              </>
                            )}
                          </button>
                        </div>

                        {/* Logo Preview - Display next to uploader */}
                        {formData.logoUrl && (
                          <div className="flex-1">
                            <div className="border-2 border-gray-200 rounded-lg p-4 bg-white">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-gray-600">Preview</span>
                                <button
                                  type="button"
                                  onClick={() => setFormData({ ...formData, logoUrl: "" })}
                                  className="text-gray-400 hover:text-red-600 transition-colors"
                                  title="Remove logo"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="h-16 w-48 bg-gray-50 border border-gray-200 rounded flex items-center justify-center overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={formData.logoUrl}
                                  alt="Logo preview"
                                  className="h-full w-full object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                    const parent = (e.target as HTMLImageElement).parentElement;
                                    if (parent) {
                                      replaceWithInvalidImageText(parent);
                                    }
                                  }}
                                />
                              </div>
                              <p className="mt-2 text-xs text-gray-500">Logo will be displayed at consistent dimensions</p>
                            </div>
                          </div>
                        )}

                        {/* URL Input - Show if no logo uploaded */}
                        {!formData.logoUrl && (
                          <div className="flex-1">
                            <input
                              type="url"
                              value={formData.logoUrl}
                              onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm box-border"
                              placeholder="Or enter logo URL manually"
                            />
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">Upload PNG, JPG, or GIF (max 5MB). Logos will be displayed at consistent dimensions.</p>
                    </div>
                  </div>

                  {/* Website Link */}
                  <div className="w-full">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Website Link
                    </label>
                    <input
                      type="url"
                      value={formData.href}
                      onChange={(e) => setFormData({ ...formData, href: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm box-border"
                      placeholder="https://example.com"
                    />
                    <p className="mt-1.5 text-xs text-gray-500">Optional link to partner's website</p>
                  </div>

                  {/* Display Order and Status - Same Line */}
                  <div className="grid grid-cols-2 gap-4 w-full">
                    <div className="w-full min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Display Order
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.displayOrder}
                        onChange={(e) => setFormData({ ...formData, displayOrder: parseInt(e.target.value, 10) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm box-border"
                      />
                      <p className="mt-1.5 text-xs text-gray-500">Lower numbers appear first</p>
                    </div>

                    <div className="w-full min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Status
                      </label>
                      <select
                        value={formData.isActive ? "active" : "inactive"}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.value === "active" })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none text-sm bg-white box-border"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>
                </div>
              </form>

              {/* Modal Footer */}
              <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="trust-partner-form"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      {editingPartner ? "Update Partner" : "Add Partner"}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-4 border-b border-slate-100 px-6 py-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <AlertTriangle className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black tracking-tight text-slate-950">Delete trust partner?</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  This will remove <span className="font-bold text-slate-900">{deleteTarget.name}</span> from the Trusted by section.
                </p>
              </div>
            </div>

            <div className="px-6 py-4">
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
                This action cannot be undone from this screen.
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 px-6 py-4">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingId === deleteTarget.id}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deletingId === deleteTarget.id}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-bold text-white shadow-[0_8px_22px_-10px_rgba(220,38,38,0.8)] transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deletingId === deleteTarget.id ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                    Delete partner
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

