import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  FileText, Target, Briefcase, Sparkles, Copy, Check, Loader2,
  LayoutGrid, ListChecks, MessageCircle, Plus, ChevronDown, X, Download, TrendingUp,
  Sun, Moon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Points at your backend. Set VITE_API_BASE in a .env file (or in your
// hosting provider's environment variables) to your deployed backend URL,
// e.g. VITE_API_BASE=https://apply-assist-api.onrender.com
// Falls back to localhost for local development if unset.
// ---------------------------------------------------------------------------
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const STATUSES = ["Saved", "Applied", "Interview", "Offer", "Rejected"];
const STATUS_COLOR = { Saved: "#7C8590", Applied: "#3E7C6B", Interview: "#C79A4B", Offer: "#5B9C7A", Rejected: "#A8503C" };

// ---------------------------------------------------------------------------
// Thin API client — every function here hits the FastAPI backend. Nothing in
// this file talks to Anthropic or Adzuna directly anymore; the backend does
// that server-side, using keys that live only in its .env file.
// ---------------------------------------------------------------------------
async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}
async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `POST ${path} failed: ${res.status}`);
  }
  return res.json();
}
async function apiPut(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
  return res.json();
}
async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
  return res.json();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildApplicationText(job, tailored) {
  return `${job.role} at ${job.company}\n${job.location} · ${job.salary || ""}\n\nTailored resume bullets:\n${tailored.bullets
    .map((b, i) => `${i + 1}. ${b}`)
    .join("\n")}\n\nCover letter:\n${tailored.coverLetter}\n`;
}

function buildTrackerCSV(entries) {
  const header = "Role,Company,Location,Status,Added";
  const rows = entries.map((e) => {
    const added = new Date(e.added_at || Date.now()).toLocaleDateString();
    return [e.job.role, e.job.company, e.job.location, e.status, added]
      .map((v) => `"${(v || "").toString().replace(/"/g, '""')}"`)
      .join(",");
  });
  return [header, ...rows].join("\n");
}

export default function ApplyAssist() {
  const [tab, setTab] = useState("profile");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem("aa-theme") || "dark";
  });
  useEffect(() => {
    localStorage.setItem("aa-theme", theme);
    document.body.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  }, [theme]);
  const styles = useMemo(() => getStyles(theme), [theme]);

  const [resumeText, setResumeText] = useState("");
  const [parsedProfile, setParsedProfile] = useState(null);
  const [prefs, setPrefs] = useState({ role: "", location: "Any", experience: "0-2 years", minSalary: "", remoteOnly: false });

  const [jobs, setJobs] = useState([]);
  const [jobsRefreshing, setJobsRefreshing] = useState(false);

  // tracker is keyed by job_id for easy lookup while rendering the job list,
  // same shape the original UI expected, plus the backend's tracker entry id.
  const [tracker, setTracker] = useState({});

  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [activeJob, setActiveJob] = useState(null);
  const [tailoring, setTailoring] = useState(false);
  const [tailorError, setTailorError] = useState(null);
  const [copied, setCopied] = useState(null);
  const [interviewLoading, setInterviewLoading] = useState(null);
  const [digestText, setDigestText] = useState("");
  const [digestSending, setDigestSending] = useState(false);
  const [digestSent, setDigestSent] = useState(false);

  // ---- initial load: profile, jobs, tracker, digest all come from the backend ----
  useEffect(() => {
    (async () => {
      try {
        const [profile, jobList, trackerList] = await Promise.all([
          apiGet("/api/profile"),
          apiGet("/api/jobs"),
          apiGet("/api/tracker"),
        ]);
        setResumeText(profile.resumeText || "");
        setParsedProfile(profile.parsedProfile || null);
        if (profile.prefs && Object.keys(profile.prefs).length) setPrefs(profile.prefs);

        setJobs(jobList);

        const trackerMap = {};
        for (const entry of trackerList) {
          trackerMap[entry.job.id] = {
            entryId: entry.id,
            status: entry.status,
            job: entry.job,
            tailored: entry.tailored,
            interviewPrep: entry.interview_prep,
            addedAt: entry.added_at,
          };
        }
        setTracker(trackerMap);
      } catch (e) {
        setLoadError("Couldn't reach the backend. Is it running at " + API_BASE + "?");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persistProfile = useCallback(async (overrides = {}) => {
    try {
      await apiPut("/api/profile", {
        resumeText: overrides.resumeText ?? resumeText,
        parsedProfile: overrides.parsedProfile ?? parsedProfile,
        prefs: overrides.prefs ?? prefs,
      });
    } catch (e) { /* best effort */ }
  }, [resumeText, parsedProfile, prefs]);

  function saveProfileNow(overrides = {}) {
    persistProfile(overrides);
  }

  async function parseResume() {
    if (!resumeText.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const profile = await apiPost("/api/profile/parse-resume", { resumeText });
      setParsedProfile(profile.parsedProfile);
      // resume text + parsed profile already saved server-side by this endpoint
      const jobList = await apiGet("/api/jobs"); // re-fetch: scores depend on parsed skills
      setJobs(jobList);
    } catch (e) {
      setParseError("Couldn't parse the resume. Try again.");
    } finally {
      setParsing(false);
    }
  }

  async function refreshJobs() {
    setJobsRefreshing(true);
    try {
      await apiPost("/api/jobs/refresh");
      const jobList = await apiGet("/api/jobs");
      setJobs(jobList);
    } catch (e) {
      // surfaced inline via jobsRefreshing turning off with no new jobs
    } finally {
      setJobsRefreshing(false);
    }
  }

  const scoredJobs = useMemo(() => {
    return jobs.filter((j) => !prefs.remoteOnly || j.remote);
  }, [jobs, prefs.remoteOnly]);

  async function generateTailored(job) {
    setActiveJob(job);
    setTailoring(true);
    setTailorError(null);
    try {
      const tailored = await apiPost(`/api/jobs/${job.id}/tailor`);
      const entry = await apiPost("/api/tracker", { job_id: job.id, status: tracker[job.id]?.status || "Saved" });
      setTracker((prev) => ({
        ...prev,
        [job.id]: {
          entryId: entry.id,
          status: entry.status,
          job,
          tailored,
          interviewPrep: prev[job.id]?.interviewPrep || null,
          addedAt: entry.added_at,
        },
      }));
    } catch (e) {
      setTailorError(e.message || "Couldn't generate the tailored application. Try again.");
    } finally {
      setTailoring(false);
    }
  }

  async function updateStatus(jobId, status) {
    setTracker((prev) => ({ ...prev, [jobId]: { ...prev[jobId], status } })); // optimistic
    try {
      await apiPost("/api/tracker", { job_id: Number(jobId), status });
    } catch (e) { /* best effort — UI already updated */ }
  }

  async function generateInterviewPrep(jobId) {
    const entry = tracker[jobId];
    if (!entry) return;
    setInterviewLoading(jobId);
    try {
      const prep = await apiPost(`/api/jobs/${jobId}/interview-prep`);
      setTracker((prev) => ({ ...prev, [jobId]: { ...prev[jobId], interviewPrep: prep } }));
    } catch (e) {
      // leave silently — inline retry button remains
    } finally {
      setInterviewLoading(null);
    }
  }

  function handleCopy(text, key) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const trackerEntries = Object.entries(tracker);
  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = trackerEntries.filter(([, v]) => v.status === s).length;
    return acc;
  }, {});

  // ---- digest: pull the live text from the backend whenever the Digest tab opens ----
  useEffect(() => {
    if (tab !== "digest") return;
    (async () => {
      try {
        const res = await apiGet("/api/digest");
        setDigestText(res.text);
      } catch (e) {
        setDigestText("Couldn't load digest — check the backend connection.");
      }
    })();
  }, [tab, trackerEntries.length]);

  async function sendDigestNow() {
    setDigestSending(true);
    setDigestSent(false);
    try {
      await apiPost("/api/digest/send");
      setDigestSent(true);
      setTimeout(() => setDigestSent(false), 3000);
    } catch (e) {
      // surfaced by digestSent staying false
    } finally {
      setDigestSending(false);
    }
  }

  return (
    <div style={styles.app}>
      <style>{`
        .aa-textarea:focus, .aa-input:focus, .aa-select:focus, .aa-btn:focus-visible, .aa-job:focus-visible {
          outline: 2px solid #C79A4B; outline-offset: 2px;
        }
        .aa-job:hover { border-color: #3E7C6B; }
        .aa-btn:hover { filter: brightness(1.08); }
        .aa-nav-item:hover { color: #E8E6E1 !important; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (max-width: 760px) {
          .aa-shell { flex-direction: column; }
          .aa-sidebar { flex-direction: row !important; width: 100% !important; overflow-x: auto; gap: 18px !important; }
          .aa-main { padding: 28px 20px !important; }
        }
      `}</style>

      <div className="aa-shell" style={styles.shell}>
        <div className="aa-sidebar" style={styles.sidebar}>
          <div style={styles.brand}><Sparkles size={18} color="#C79A4B" /><span style={styles.brandText}>Apply Assist</span></div>
          <NavItem styles={styles} icon={FileText} label="Profile" active={tab === "profile"} onClick={() => setTab("profile")} />
          <NavItem styles={styles} icon={LayoutGrid} label="Matches" active={tab === "matches"} onClick={() => setTab("matches")} />
          <NavItem styles={styles} icon={ListChecks} label={`Tracker${trackerEntries.length ? ` (${trackerEntries.length})` : ""}`} active={tab === "tracker"} onClick={() => setTab("tracker")} />
          <NavItem styles={styles} icon={TrendingUp} label="Digest" active={tab === "digest"} onClick={() => setTab("digest")} />
          <button
            className="aa-btn"
            style={styles.themeToggle}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle light/dark mode"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>

        <div className="aa-main" style={styles.main}>
          {!ready && <div style={styles.loadingBox}><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /> Loading your data…</div>}
          {ready && loadError && <div style={styles.errorBox}>{loadError}</div>}

          {ready && tab === "profile" && (
            <Section styles={styles} title="Your profile" subtitle="Saved to your backend database — resume text and preferences persist across sessions and devices.">
              <label style={styles.blockLabel}>Resume text</label>
              <textarea
                className="aa-textarea"
                style={styles.textarea}
                placeholder="Paste your resume text here — experience, skills, education..."
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                onBlur={() => saveProfileNow()}
              />
              <div style={styles.footerRow}>
                <span style={styles.hint}>{parsedProfile ? `${(parsedProfile.skills || []).length} skills detected` : "Add resume text, then parse to enable matching"}</span>
                <button className="aa-btn" style={styles.primaryBtn} onClick={parseResume} disabled={!resumeText.trim() || parsing}>
                  {parsing ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={15} />}
                  {parsing ? "Parsing…" : "Parse with AI"}
                </button>
              </div>
              {parseError && <div style={styles.errorBox}>{parseError}</div>}

              {parsedProfile && (
                <div style={styles.parsedBox}>
                  <div style={styles.parsedGroup}>
                    <div style={styles.parsedLabel}>Skills</div>
                    <div style={styles.chipRow}>
                      {(parsedProfile.skills || []).map((s, i) => <span key={i} style={styles.chip}>{s}</span>)}
                    </div>
                  </div>
                  {(parsedProfile.experience || []).length > 0 && (
                    <div style={styles.parsedGroup}>
                      <div style={styles.parsedLabel}>Experience</div>
                      {parsedProfile.experience.map((e, i) => (
                        <div key={i} style={styles.expItem}>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{e.title} · {e.company}</div>
                          <div style={{ fontSize: 12, color: styles.muted, marginBottom: 4 }}>{e.duration}</div>
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {(e.highlights || []).map((h, j) => <li key={j} style={{ fontSize: 12.5, color: styles.mutedLight, lineHeight: 1.5 }}>{h}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                  {(parsedProfile.education || []).length > 0 && (
                    <div style={styles.parsedGroup}>
                      <div style={styles.parsedLabel}>Education</div>
                      {parsedProfile.education.map((ed, i) => (
                        <div key={i} style={{ fontSize: 12.5, color: styles.mutedLight }}>{ed.degree} — {ed.institution} ({ed.year})</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={styles.divider} />

              <label style={styles.blockLabel}>Preferences</label>
              <div style={styles.formGrid}>
                <label style={styles.label}>Target role
                  <input className="aa-input" style={styles.input} placeholder="e.g. Data Analyst" value={prefs.role}
                    onChange={(e) => setPrefs({ ...prefs, role: e.target.value })} onBlur={() => saveProfileNow()} />
                </label>
                <label style={styles.label}>Location
                  <select className="aa-select" style={styles.input} value={prefs.location}
                    onChange={(e) => { const next = { ...prefs, location: e.target.value }; setPrefs(next); saveProfileNow({ prefs: next }); }}>
                    {["Any", "Bengaluru", "Mumbai", "Delhi NCR", "Pune", "Hyderabad", "Remote"].map((l) => <option key={l}>{l}</option>)}
                  </select>
                </label>
                <label style={styles.label}>Experience
                  <select className="aa-select" style={styles.input} value={prefs.experience}
                    onChange={(e) => { const next = { ...prefs, experience: e.target.value }; setPrefs(next); saveProfileNow({ prefs: next }); }}>
                    {["0-2 years", "2-5 years", "5-8 years", "8+ years"].map((l) => <option key={l}>{l}</option>)}
                  </select>
                </label>
                <label style={styles.label}>Minimum salary (LPA)
                  <input className="aa-input" style={styles.input} placeholder="e.g. 8" value={prefs.minSalary}
                    onChange={(e) => setPrefs({ ...prefs, minSalary: e.target.value })} onBlur={() => saveProfileNow()} />
                </label>
                <label style={{ ...styles.label, flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={prefs.remoteOnly}
                    onChange={(e) => { const next = { ...prefs, remoteOnly: e.target.checked }; setPrefs(next); saveProfileNow({ prefs: next }); }} />
                  Remote only
                </label>
              </div>
            </Section>
          )}

          {ready && tab === "matches" && (
            <Section styles={styles} title="Matched openings" subtitle="Live listings pulled from Adzuna, scored against your resume.">
              <div style={{ ...styles.footerRow, marginBottom: 4 }}>
                <span style={styles.hint}>{scoredJobs.length} job{scoredJobs.length === 1 ? "" : "s"}</span>
                <button className="aa-btn" style={styles.copyBtn} onClick={refreshJobs} disabled={jobsRefreshing}>
                  {jobsRefreshing ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />}
                  {jobsRefreshing ? "Refreshing…" : "Refresh jobs"}
                </button>
              </div>
              <div style={styles.jobList}>
                {scoredJobs.map((job) => {
                  const entry = tracker[job.id];
                  return (
                    <div key={job.id} className="aa-job" tabIndex={0} style={{ ...styles.jobCard, borderColor: activeJob?.id === job.id ? "#3E7C6B" : "#2C333B" }}>
                      <div style={styles.jobTop}>
                        <div>
                          <div style={styles.jobRole}>{job.role}</div>
                          <div style={styles.jobMeta}>{job.company} · {job.location} · {job.salary}</div>
                        </div>
                        <div style={styles.scoreBadge}>{job.score}%</div>
                      </div>
                      <p style={styles.jobDesc}>{job.desc}</p>
                      <div style={styles.jobActions}>
                        <button className="aa-btn" style={styles.smallPrimaryBtn} onClick={() => generateTailored(job)} disabled={tailoring && activeJob?.id === job.id}>
                          {tailoring && activeJob?.id === job.id ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Sparkles size={13} />}
                          {entry?.tailored ? "Regenerate" : "Tailor application"}
                        </button>
                        {entry && <span style={{ ...styles.statusTag, color: STATUS_COLOR[entry.status] }}>{entry.status}</span>}
                      </div>

                      {activeJob?.id === job.id && tailorError && <div style={styles.errorBox}>{tailorError}</div>}
                      {entry?.tailored && activeJob?.id === job.id && (
                        <TailoredView styles={styles} tailored={entry.tailored} onCopy={handleCopy} copied={copied} idPrefix={job.id} job={job} />
                      )}
                    </div>
                  );
                })}
                {scoredJobs.length === 0 && (
                  <p style={{ color: styles.muted, fontSize: 14 }}>No jobs yet — click "Refresh jobs" to pull listings from Adzuna.</p>
                )}
              </div>
            </Section>
          )}

          {ready && tab === "tracker" && (
            <Section styles={styles} title="Application tracker" subtitle="Everything you've tailored or logged, in one place.">
              <div style={{ ...styles.statRow, justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  {STATUSES.map((s) => (
                    <div key={s} style={styles.statChip}>
                      <span style={{ color: STATUS_COLOR[s], fontWeight: 700 }}>{statusCounts[s]}</span> {s}
                    </div>
                  ))}
                </div>
                {trackerEntries.length > 0 && (
                  <button
                    className="aa-btn"
                    style={styles.copyBtn}
                    onClick={() => downloadTextFile("applications.csv", buildTrackerCSV(trackerEntries.map(([, e]) => e)))}
                  >
                    <Download size={12} /> Export CSV
                  </button>
                )}
              </div>

              {trackerEntries.length === 0 && (
                <p style={{ color: styles.muted, fontSize: 14 }}>No applications yet — generate a tailored application from the Matches tab to add one here.</p>
              )}

              <div style={styles.jobList}>
                {trackerEntries.map(([jobId, entry]) => (
                  <div key={jobId} style={styles.jobCard}>
                    <div style={styles.jobTop}>
                      <div>
                        <div style={styles.jobRole}>{entry.job.role}</div>
                        <div style={styles.jobMeta}>{entry.job.company} · {entry.job.location}</div>
                      </div>
                      <select className="aa-select" style={styles.statusSelect} value={entry.status} onChange={(e) => updateStatus(jobId, e.target.value)}>
                        {STATUSES.map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>

                    {entry.tailored && <TailoredView styles={styles} tailored={entry.tailored} onCopy={handleCopy} copied={copied} idPrefix={jobId} job={entry.job} />}

                    <div style={{ marginTop: 14 }}>
                      {!entry.interviewPrep ? (
                        <button className="aa-btn" style={styles.smallPrimaryBtn} onClick={() => generateInterviewPrep(jobId)} disabled={interviewLoading === jobId}>
                          {interviewLoading === jobId ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <MessageCircle size={13} />}
                          Generate interview prep
                        </button>
                      ) : (
                        <div style={styles.resultCard}>
                          <div style={styles.resultHeader}><span style={styles.resultTitle}><MessageCircle size={14} /> Likely interview questions</span></div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {entry.interviewPrep.questions.map((q, i) => (
                              <div key={i}>
                                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{i + 1}. {q.question}</div>
                                <div style={{ fontSize: 12.5, color: styles.muted, marginTop: 2 }}>{q.tip}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {ready && tab === "digest" && (
            <Section styles={styles} title="Weekly digest" subtitle="Computed live from your tracker. A copy is also emailed automatically every week by the backend scheduler.">
              <pre style={styles.digestBox}>{digestText}</pre>
              <div style={styles.footerRow}>
                <span style={styles.hint}>{trackerEntries.length} application{trackerEntries.length === 1 ? "" : "s"} tracked</span>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="aa-btn" style={styles.copyBtn} onClick={() => handleCopy(digestText, "digest")}>
                    {copied === "digest" ? <Check size={15} /> : <Copy size={15} />}
                    {copied === "digest" ? "Copied" : "Copy digest"}
                  </button>
                  <button className="aa-btn" style={styles.primaryBtn} onClick={sendDigestNow} disabled={digestSending}>
                    {digestSending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <TrendingUp size={15} />}
                    {digestSent ? "Sent!" : digestSending ? "Sending…" : "Email now"}
                  </button>
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function NavItem({ styles, icon: Icon, label, active, onClick }) {
  return (
    <div className="aa-nav-item" onClick={onClick} style={{ ...styles.navItem, color: active ? styles.textColor : styles.muted, borderColor: active ? "#3E7C6B" : "transparent" }}>
      <Icon size={16} /><span style={{ fontSize: 14 }}>{label}</span>
    </div>
  );
}

function Section({ styles, title, subtitle, children }) {
  return (
    <div>
      <h1 style={styles.h1}>{title}</h1>
      {subtitle && <p style={styles.subtitle}>{subtitle}</p>}
      <div style={{ marginTop: 24 }}>{children}</div>
    </div>
  );
}

function TailoredView({ styles, tailored, onCopy, copied, idPrefix, job }) {
  return (
    <div style={styles.resultGrid}>
      {job && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="aa-btn"
            style={styles.copyBtn}
            onClick={() => downloadTextFile(`${job.company}-${job.role}.txt`.replace(/\s+/g, "_"), buildApplicationText(job, tailored))}
          >
            <Download size={12} /> Download as file
          </button>
        </div>
      )}
      <div style={styles.resultCard}>
        <div style={styles.resultHeader}>
          <span style={styles.resultTitle}><FileText size={14} /> Tailored resume bullets</span>
          <CopyBtn styles={styles} onCopy={() => onCopy(tailored.bullets.join("\n"), `${idPrefix}-bullets`)} copied={copied === `${idPrefix}-bullets`} />
        </div>
        <ul style={styles.bulletList}>{tailored.bullets.map((b, i) => <li key={i} style={styles.bulletItem}>{b}</li>)}</ul>
      </div>
      <div style={styles.resultCard}>
        <div style={styles.resultHeader}>
          <span style={styles.resultTitle}><Briefcase size={14} /> Cover letter</span>
          <CopyBtn styles={styles} onCopy={() => onCopy(tailored.coverLetter, `${idPrefix}-cover`)} copied={copied === `${idPrefix}-cover`} />
        </div>
        <p style={styles.coverLetter}>{tailored.coverLetter}</p>
      </div>
    </div>
  );
}

function CopyBtn({ styles, onCopy, copied }) {
  return <button className="aa-btn" style={styles.copyBtn} onClick={onCopy}>{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "Copied" : "Copy"}</button>;
}

function getStyles(theme) {
  const dark = theme !== "light";

  // Core palette per theme
  const bg = dark ? "#15191E" : "#F5F3EE";
  const bgAlt = dark ? "#1A1F25" : "#FFFFFF";
  const bgField = dark ? "#1D2229" : "#FFFFFF";
  const border = dark ? "#2C333B" : "#DCD8CF";
  const text = dark ? "#E8E6E1" : "#20242B";
  const textSoft = dark ? "#D4D6D9" : "#3A3F47";
  const muted = dark ? "#8B9199" : "#6B7280";
  const mutedLight = dark ? "#A8AEB6" : "#565C64";
  const navInactive = dark ? "#7C8590" : "#7A7F87";
  const accent = "#3E7C6B";
  const accentText = "#EAF3F0";
  const gold = "#C79A4B";

  return {
    theme,
    textColor: text,
    muted,
    mutedLight,
    app: { fontFamily: "Inter, -apple-system, 'Segoe UI', sans-serif", background: bg, color: text, minHeight: "100vh" },
    shell: { display: "flex", minHeight: "100vh" },
    sidebar: { width: 220, borderRight: `1px solid ${border}`, padding: "28px 20px", display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 },
    brand: { display: "flex", alignItems: "center", gap: 8, marginBottom: 26 },
    brandText: { fontFamily: "ui-serif, Georgia, serif", fontSize: 17 },
    navItem: { display: "flex", alignItems: "center", gap: 10, padding: "9px 8px", cursor: "pointer", borderLeft: "2px solid transparent" },
    themeToggle: {
      marginTop: "auto", background: "none", border: `1px solid ${border}`, color: muted, borderRadius: 6,
      padding: "8px 10px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit",
    },
    main: { flex: 1, padding: "48px 56px", maxWidth: 780 },
    h1: { fontFamily: "ui-serif, Georgia, serif", fontSize: 28, fontWeight: 500, margin: 0 },
    subtitle: { color: muted, fontSize: 14, marginTop: 8, lineHeight: 1.5 },
    blockLabel: { display: "block", fontSize: 13, color: muted, marginBottom: 8 },
    textarea: { width: "100%", minHeight: 180, background: bgField, border: `1px solid ${border}`, borderRadius: 6, color: text, padding: 16, fontSize: 14.5, lineHeight: 1.6, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" },
    footerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
    hint: { fontSize: 13, color: navInactive },
    primaryBtn: { background: accent, color: accentText, border: "none", borderRadius: 6, padding: "10px 16px", fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontFamily: "inherit" },
    smallPrimaryBtn: { background: accent, color: accentText, border: "none", borderRadius: 5, padding: "6px 12px", fontSize: 12.5, cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontFamily: "inherit" },
    errorBox: { color: "#D97757", fontSize: 13, padding: "10px 0" },
    parsedBox: { marginTop: 20, display: "flex", flexDirection: "column", gap: 18 },
    parsedGroup: {},
    parsedLabel: { fontSize: 12.5, color: muted, marginBottom: 8, textTransform: "none" },
    chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
    chip: { background: bgField, border: `1px solid ${border}`, borderRadius: 20, padding: "3px 10px", fontSize: 12 },
    expItem: { marginBottom: 12 },
    divider: { height: 1, background: border, margin: "28px 0" },
    formGrid: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 420 },
    label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: muted },
    input: { background: bgField, border: `1px solid ${border}`, borderRadius: 6, color: text, padding: "9px 12px", fontSize: 14, fontFamily: "inherit" },
    jobList: { display: "flex", flexDirection: "column", gap: 14 },
    jobCard: { border: `1px solid ${border}`, borderRadius: 8, padding: "16px 18px", background: bgAlt },
    jobTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
    jobRole: { fontSize: 16, fontWeight: 600 },
    jobMeta: { fontSize: 13, color: muted, marginTop: 3 },
    scoreBadge: { background: "rgba(199,154,75,0.15)", color: gold, fontSize: 13, fontWeight: 600, padding: "3px 10px", borderRadius: 20, flexShrink: 0 },
    jobDesc: { fontSize: 13.5, color: mutedLight, marginTop: 10, lineHeight: 1.55 },
    jobActions: { display: "flex", alignItems: "center", gap: 12, marginTop: 12 },
    statusTag: { fontSize: 12.5, fontWeight: 600 },
    statusSelect: { background: bgField, border: `1px solid ${border}`, borderRadius: 5, color: text, padding: "5px 8px", fontSize: 12.5, fontFamily: "inherit" },
    resultGrid: { display: "flex", flexDirection: "column", gap: 14, marginTop: 14 },
    resultCard: { background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 16 },
    resultHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    resultTitle: { display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600 },
    copyBtn: { background: "none", border: `1px solid ${border}`, color: muted, borderRadius: 5, padding: "4px 9px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 },
    bulletList: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 },
    bulletItem: { fontSize: 13.5, lineHeight: 1.5, color: textSoft },
    coverLetter: { fontSize: 13.5, lineHeight: 1.65, color: textSoft, whiteSpace: "pre-wrap", margin: 0 },
    loadingBox: { display: "flex", alignItems: "center", gap: 10, color: muted, padding: "24px 0" },
    statRow: { display: "flex", gap: 18, marginBottom: 22, flexWrap: "wrap" },
    statChip: { fontSize: 13, color: muted },
    digestBox: {
      background: bgAlt, border: `1px solid ${border}`, borderRadius: 8, padding: 20,
      fontSize: 13, lineHeight: 1.7, color: textSoft, whiteSpace: "pre-wrap",
      fontFamily: "ui-monospace, monospace", margin: 0,
    },
  };
}
