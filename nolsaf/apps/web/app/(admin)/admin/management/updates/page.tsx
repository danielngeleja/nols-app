"use client";

import Image from "next/image";
import { Megaphone, Plus, Image as ImageIcon, Video, X, Edit, Trash2, Calendar, Loader2, Play } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import axios from "axios";

const api = axios.create({ baseURL: "" });

interface Update {
  id: string;
  title: string;
  content: string;
  images?: string[];
  videos?: string[];
  createdAt: string;
  updatedAt: string;
}

export default function UpdatesPage() {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    content: "",
    images: [] as File[],
    videoUrls: [] as string[], // Changed to YouTube URLs
    existingImages: [] as string[],
    existingVideos: [] as string[],
  });
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [newVideoUrl, setNewVideoUrl] = useState(""); // For adding new YouTube URLs
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadUpdates();
  }, []);

  const loadUpdates = async () => {
    try {
      setLoading(true);
      const res = await api.get("/api/admin/updates", { withCredentials: true });
      setUpdates(res.data?.items || []);
    } catch (err: any) {
      console.error("Failed to load updates:", err);
      setError(err?.response?.data?.message || "Failed to load updates");
    } finally {
      setLoading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    setFormData({ ...formData, images: [...formData.images, ...imageFiles] });
    
    // Create previews
    imageFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreviews((prev) => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const extractYouTubeId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const passthroughLoader = ({ src }: { src: string }) => src;

  const getYouTubeThumb = (embedOrWatchUrl: string): string | null => {
    const id = extractYouTubeId(embedOrWatchUrl);
    if (!id) return null;
    return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  };

  const addVideoUrl = () => {
    if (!newVideoUrl.trim()) return;
    const videoId = extractYouTubeId(newVideoUrl.trim());
    if (!videoId) {
      setError("Please enter a valid YouTube URL");
      return;
    }
    const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
    setFormData({
      ...formData,
      videoUrls: [...formData.videoUrls, embedUrl],
    });
    setNewVideoUrl("");
    setError(null);
  };

  const removeImage = (index: number) => {
    const newImages = formData.images.filter((_, i) => i !== index);
    const newPreviews = imagePreviews.filter((_, i) => i !== index);
    setFormData({ ...formData, images: newImages });
    setImagePreviews(newPreviews);
  };

  const removeExistingImage = (url: string) => {
    setFormData({
      ...formData,
      existingImages: formData.existingImages.filter((img) => img !== url),
    });
  };

  const removeVideoUrl = (index: number) => {
    setFormData({
      ...formData,
      videoUrls: formData.videoUrls.filter((_, i) => i !== index),
    });
  };

  const removeExistingVideo = (url: string) => {
    setFormData({
      ...formData,
      existingVideos: formData.existingVideos.filter((vid) => vid !== url),
    });
  };

  const resetForm = () => {
    setFormData({
      title: "",
      content: "",
      images: [],
      videoUrls: [],
      existingImages: [],
      existingVideos: [],
    });
    setImagePreviews([]);
    setNewVideoUrl("");
    setEditingId(null);
    setShowForm(false);
    setError(null);
    setSuccess(null);
    setActiveVideoUrl(null);
  };

  const handleEdit = (update: Update) => {
    setFormData({
      title: update.title,
      content: update.content,
      images: [],
      videoUrls: [],
      existingImages: update.images || [],
      existingVideos: update.videos || [],
    });
    setImagePreviews([]);
    setNewVideoUrl("");
    setEditingId(update.id);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      const fd = new FormData();
      fd.append("title", formData.title);
      fd.append("content", formData.content);
      
      formData.images.forEach((img) => fd.append("images", img));
      // Combine new video URLs with existing videos
      const allVideos = [...formData.videoUrls, ...formData.existingVideos];
      allVideos.forEach((vid) => fd.append("existingVideos", vid));
      formData.existingImages.forEach((img) => fd.append("existingImages", img));

      if (editingId) {
        await api.put(`/api/admin/updates/${editingId}`, fd, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          withCredentials: true,
        });
        setSuccess("Update updated successfully!");
      } else {
        await api.post("/api/admin/updates", fd, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          withCredentials: true,
        });
        setSuccess("Update created successfully!");
      }

      resetForm();
      loadUpdates();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to save update");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirmId) return;
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    try {
      await api.delete(`/api/admin/updates/${id}`, { withCredentials: true });
      setSuccess("Update deleted successfully!");
      loadUpdates();
    } catch (err: any) {
      setError(err?.response?.data?.message || "Failed to delete update");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6 w-full min-w-0">
      {deleteConfirmId && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete"
          onClick={() => setDeleteConfirmId(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 flex flex-col items-center gap-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                <Trash2 className="h-6 w-6 text-red-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Delete this update?</h2>
                <p className="mt-1 text-sm text-slate-500">This action cannot be undone.</p>
              </div>
              <div className="flex gap-3 w-full mt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(null)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteConfirmed}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeVideoUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Video preview"
          onClick={() => setActiveVideoUrl(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div className="text-sm font-semibold text-slate-900">Video preview</div>
              <button
                type="button"
                onClick={() => setActiveVideoUrl(null)}
                className="p-2 rounded-lg hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-slate-700" />
              </button>
            </div>
            <div className="aspect-video w-full bg-slate-100">
              <iframe
                src={activeVideoUrl}
                className="w-full h-full"
                frameBorder="0"
                loading="lazy"
                referrerPolicy="no-referrer"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-[#02665e]/8 via-white to-sky-50" />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#02665e]/10 ring-1 ring-inset ring-[#02665e]/20">
              <Megaphone className="h-6 w-6 text-[#02665e]" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
                Updates Management
              </h1>
              <p className="mt-1 text-sm text-slate-600 max-w-2xl mx-auto">
                Share news and events with your users
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-slate-900">All Updates</h2>
            <button
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-2xl bg-[#02665e] text-white font-semibold shadow-sm ring-1 ring-black/[0.03] transition-[transform,box-shadow,background-color] duration-300 ease-out hover:-translate-y-[1px] hover:shadow-md hover:bg-[#02665e]/90 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30"
            >
              <Plus className="w-4 h-4" />
              Create Update
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 shadow-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 shadow-sm">
          {success}
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm max-w-full overflow-hidden">
          <h3 className="text-lg font-semibold mb-4">
            {editingId ? "Edit Update" : "Create New Update"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-full">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title *
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full max-w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-200 box-border"
                required
                placeholder="Update title"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Content *
              </label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                className="w-full max-w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-200 h-32 resize-y box-border"
                required
                placeholder="Update content..."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Images
                </label>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full max-w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-emerald-600 transition-colors flex items-center justify-center gap-2 text-gray-600 box-border"
                >
                  <ImageIcon className="w-5 h-5 flex-shrink-0" />
                  <span className="truncate">Add Images</span>
                </button>
                {(imagePreviews.length > 0 || formData.existingImages.length > 0) && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {formData.existingImages.map((img, idx) => (
                      <div key={`existing-${idx}`} className="relative group min-w-0">
                        <Image
                          loader={passthroughLoader}
                          unoptimized
                          src={img}
                          alt={`Preview ${idx + 1}`}
                          width={320}
                          height={192}
                          sizes="(max-width: 768px) 33vw, 140px"
                          className="w-full h-24 object-cover rounded border"
                        />
                        <button
                          type="button"
                          onClick={() => removeExistingImage(img)}
                          className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {imagePreviews.map((preview, idx) => (
                      <div key={idx} className="relative group min-w-0">
                        <Image
                          loader={passthroughLoader}
                          unoptimized
                          src={preview}
                          alt={`Preview ${idx + 1}`}
                          width={320}
                          height={192}
                          sizes="(max-width: 768px) 33vw, 140px"
                          className="w-full h-24 object-cover rounded border"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(idx)}
                          className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="min-w-0">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  YouTube Videos
                </label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newVideoUrl}
                      onChange={(e) => {
                        setNewVideoUrl(e.target.value);
                        setError(null);
                      }}
                      placeholder="Paste YouTube URL here"
                      className="flex-1 min-w-0 max-w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-200 box-border text-sm"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addVideoUrl();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addVideoUrl}
                      className="px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors flex-shrink-0 whitespace-nowrap text-sm"
                    >
                      <Video className="w-4 h-4 inline mr-1" />
                      Add
                    </button>
                  </div>
                  {(formData.videoUrls.length > 0 || formData.existingVideos.length > 0) && (
                    <div className="space-y-2 max-w-full">
                      {formData.existingVideos.map((vid, idx) => (
                        <div key={`existing-vid-${idx}`} className="relative group w-full">
                          <button
                            type="button"
                            onClick={() => setActiveVideoUrl(vid)}
                            className="relative w-full aspect-video rounded border overflow-hidden bg-gray-100 text-left"
                            aria-label="Preview video"
                          >
                            {(() => {
                              const thumb = getYouTubeThumb(vid);
                              return thumb ? (
                                <Image
                                  loader={passthroughLoader}
                                  unoptimized
                                  src={thumb}
                                  alt="Video thumbnail"
                                  width={640}
                                  height={360}
                                  sizes="(max-width: 768px) 100vw, 520px"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-500">
                                  <Video className="w-6 h-6" />
                                </div>
                              );
                            })()}
                            <span className="absolute inset-0 grid place-items-center">
                              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/90 border border-slate-200 shadow-sm">
                                <Play className="w-5 h-5 text-emerald-700" />
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeExistingVideo(vid)}
                            className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      {formData.videoUrls.map((embedUrl, idx) => (
                        <div key={idx} className="relative group w-full">
                          <button
                            type="button"
                            onClick={() => setActiveVideoUrl(embedUrl)}
                            className="relative w-full aspect-video rounded border overflow-hidden bg-gray-100 text-left"
                            aria-label="Preview video"
                          >
                            {(() => {
                              const thumb = getYouTubeThumb(embedUrl);
                              return thumb ? (
                                <Image
                                  loader={passthroughLoader}
                                  unoptimized
                                  src={thumb}
                                  alt="Video thumbnail"
                                  width={640}
                                  height={360}
                                  sizes="(max-width: 768px) 100vw, 520px"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-500">
                                  <Video className="w-6 h-6" />
                                </div>
                              );
                            })()}
                            <span className="absolute inset-0 grid place-items-center">
                              <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/90 border border-slate-200 shadow-sm">
                                <Play className="w-5 h-5 text-emerald-700" />
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeVideoUrl(idx)}
                            className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={uploading}
                className="flex-1 px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Update"
                )}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading updates...</div>
      ) : updates.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No updates yet. Create your first update!
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {updates.map((update) => (
            <div
              key={update.id}
              className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {update.title}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Calendar className="w-4 h-4" />
                    <span>{formatDate(update.createdAt)}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(update)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="Edit"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(update.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <p className="text-gray-700 mb-4 whitespace-pre-wrap">{update.content}</p>

              {update.images && update.images.length > 0 && (
                <div className="mb-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {(() => {
                      const images = update.images ?? [];
                      const totalImages = images.length;
                      return images.slice(0, 4).map((img, idx) => (
                        <div key={idx} className="relative">
                          <Image
                            loader={passthroughLoader}
                            unoptimized
                            src={img}
                            alt={`${update.title} - Image ${idx + 1}`}
                            width={640}
                            height={360}
                            sizes="(max-width: 768px) 50vw, 220px"
                            className="w-full h-32 object-cover rounded border"
                          />
                          {idx === 3 && totalImages > 4 && (
                            <div className="absolute inset-0 rounded border bg-black/50 text-white flex items-center justify-center text-sm font-semibold">
                              +{totalImages - 4}
                            </div>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              )}

              {update.videos && update.videos.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {update.videos.slice(0, 2).map((vid, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActiveVideoUrl(vid)}
                        className="relative w-full aspect-video rounded border overflow-hidden bg-gray-100 text-left"
                        aria-label="Preview video"
                      >
                        {(() => {
                          const thumb = getYouTubeThumb(vid);
                          return thumb ? (
                            <Image
                              loader={passthroughLoader}
                              unoptimized
                              src={thumb}
                              alt="Video thumbnail"
                              width={640}
                              height={360}
                              sizes="(max-width: 768px) 100vw, 520px"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-500">
                              <Video className="w-6 h-6" />
                            </div>
                          );
                        })()}
                        <span className="absolute inset-0 grid place-items-center">
                          <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/90 border border-slate-200 shadow-sm">
                            <Play className="w-5 h-5 text-emerald-700" />
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {update.videos.length > 2 && (
                    <div className="text-xs text-gray-500">+{update.videos.length - 2} more videos</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
