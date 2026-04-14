"use client";
import React from "react";
import { ContainerScroll } from "@/components/ui/container-scroll-animation";

// ─── Fake CRM data ────────────────────────────────────────────────────────────

const tableHeaders = [
  { id: "name",     label: "שם הליד" },
  { id: "assignee", label: "נציג" },
  { id: "status",   label: "סטטוס" },
  { id: "priority", label: "עדיפות" },
  { id: "dueDate",  label: "תאריך פנייה" },
  { id: "project",  label: "מקור" },
  { id: "phone",    label: "טלפון" },
  { id: "email",    label: "מייל" },
];

const tableRows = [
  { id: 1,  name: "דני לוי",       assignee: "יוסי כהן",  status: "סגור",        statusColor: "green",  priority: "גבוהה",  priorityColor: "red",    dueDate: "26/03/2026", project: "פייסבוק",  phone: "050-1234567", email: "dani.levi@gmail.com" },
  { id: 2,  name: "מיכל אברהם",   assignee: "רחל גולן",  status: "בטיפול",      statusColor: "blue",   priority: "בינונית", priorityColor: "yellow", dueDate: "25/03/2026", project: "אינסטגרם", phone: "052-9876543", email: "michal.a@walla.co.il" },
  { id: 3,  name: "אבי שרון",     assignee: "יוסי כהן",  status: "ממתין למענה", statusColor: "yellow", priority: "גבוהה",  priorityColor: "red",    dueDate: "24/03/2026", project: "וואטסאפ",  phone: "054-4561230", email: "avi.sharon@hotmail.com" },
  { id: 4,  name: "שרה פרץ",      assignee: "רחל גולן",  status: "חדש",         statusColor: "blue",   priority: "נמוכה",  priorityColor: "green",  dueDate: "26/03/2026", project: "פייסבוק",  phone: "053-7654321", email: "sara.peretz@gmail.com" },
  { id: 5,  name: "נועם ביטון",   assignee: "יוסי כהן",  status: "אבוד",        statusColor: "gray",   priority: "נמוכה",  priorityColor: "green",  dueDate: "20/03/2026", project: "וואטסאפ",  phone: "058-3219870", email: "noam.biton@gmail.com" },
  { id: 6,  name: "תמר כץ",       assignee: "רחל גולן",  status: "חדש",         statusColor: "blue",   priority: "בינונית", priorityColor: "yellow", dueDate: "27/03/2026", project: "אינסטגרם", phone: "050-6543210", email: "tamar.katz@walla.co.il" },
  { id: 7,  name: "רון אלון",     assignee: "יוסי כהן",  status: "בטיפול",      statusColor: "blue",   priority: "גבוהה",  priorityColor: "red",    dueDate: "26/03/2026", project: "פייסבוק",  phone: "052-1237890", email: "ron.alon@gmail.com" },
  { id: 8,  name: "לימור דוד",    assignee: "רחל גולן",  status: "חדש",         statusColor: "blue",   priority: "בינונית", priorityColor: "yellow", dueDate: "28/03/2026", project: "אינסטגרם", phone: "054-8871234", email: "limor.david@gmail.com" },
  { id: 9,  name: "גיל מזרחי",    assignee: "יוסי כהן",  status: "ממתין למענה", statusColor: "yellow", priority: "גבוהה",  priorityColor: "red",    dueDate: "27/03/2026", project: "וואטסאפ",  phone: "050-3345678", email: "gil.mizrahi@hotmail.com" },
  { id: 10, name: "יעל ברקוביץ",  assignee: "רחל גולן",  status: "סגור",        statusColor: "green",  priority: "נמוכה",  priorityColor: "green",  dueDate: "29/03/2026", project: "פייסבוק",  phone: "053-9912345", email: "yael.b@walla.co.il" },
  
];

const statusColorMap: Record<string, { dot: string; badge: string; text: string }> = {
  green:  { dot: "bg-green-500",  badge: "bg-green-100",  text: "text-green-800"  },
  blue:   { dot: "bg-blue-500",   badge: "bg-blue-100",   text: "text-blue-800"   },
  yellow: { dot: "bg-yellow-500", badge: "bg-yellow-100", text: "text-yellow-800" },
  gray:   { dot: "bg-gray-400",   badge: "bg-gray-100",   text: "text-gray-600"   },
};

const priorityColorMap: Record<string, { badge: string; text: string }> = {
  red:    { badge: "bg-red-100",    text: "text-red-700"    },
  yellow: { badge: "bg-yellow-100", text: "text-yellow-700" },
  green:  { badge: "bg-green-100",  text: "text-green-700"  },
};

// ─── Fake CRM preview ─────────────────────────────────────────────────────────

function FakeCRMPreview() {
  return (
    <div className="h-full w-full flex flex-col bg-gray-50 rounded-2xl overflow-hidden" dir="rtl">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          {["נציג", "סטטוס", "מקור"].map((label) => (
            <button
              key={label}
              className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 rounded text-xs text-gray-500 bg-white hover:bg-gray-50"
            >
              {label}
              <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 rounded text-xs text-gray-600 bg-white">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            ייבוא מאקסל
          </button>
          <button className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white rounded text-xs font-semibold">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            הוסף ליד
          </button>
        </div>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[1.6fr_1fr_1fr_0.9fr_1fr_0.8fr_1.1fr_1.5fr] gap-[51px] px-4 py-2 bg-gray-100 border-b border-gray-200 shrink-0">
        {tableHeaders.map((h, i) => (
          <div key={h.id} className="text-[11px] font-medium text-gray-500 truncate flex items-center gap-2">
            {i === 0 && <span className="shrink-0 w-2 h-2 rounded-full opacity-0" />}
            {h.label}
          </div>
        ))}
      </div>

      {/* Table rows */}
      <div className="flex-1 overflow-hidden bg-white divide-y divide-gray-100">
        {tableRows.map((row) => {
          const s = statusColorMap[row.statusColor] ?? statusColorMap.gray;
          const p = priorityColorMap[row.priorityColor] ?? priorityColorMap.yellow;
          return (
            <div
              key={row.id}
              className="grid grid-cols-[1.6fr_1fr_1fr_0.9fr_1fr_0.8fr_1.1fr_1.5fr] gap-4 px-4 py-2.5 items-center hover:bg-gray-50 cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`shrink-0 w-2 h-2 rounded-full ${s.dot}`} />
                <span className="text-xs font-medium text-gray-800 truncate">{row.name}</span>
              </div>
              <div className="text-xs text-gray-600 truncate">{row.assignee}</div>
              <div>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${s.badge} ${s.text}`}>
                  {row.status}
                </span>
              </div>
              <div>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${p.badge} ${p.text}`}>
                  {row.priority}
                </span>
              </div>
              <div className="text-xs text-gray-500">{row.dueDate}</div>
              <div className="text-xs text-gray-500 truncate">{row.project}</div>
              <div className="text-xs text-gray-400">{row.phone}</div>
              <div className="text-xs text-gray-400 truncate">{row.email}</div>
            </div>
          );
        })}
      </div>

      {/* Footer count */}
      <div className="px-4 py-2 bg-white border-t border-gray-100 text-[11px] text-gray-400 shrink-0">
        10 לידים
      </div>
    </div>
  );
}

// ─── HeroScroll ───────────────────────────────────────────────────────────────

export default function HeroScroll() {
  return (
    <div className="flex flex-col overflow-hidden">
      <ContainerScroll
        titleComponent={
          <div dir="rtl">
            <p className="text-lg text-gray-500 mb-2">למה עסקים בוחרים ב-SocialCRM?</p>
            <h2 className="text-4xl md:text-6xl font-bold text-black leading-tight">
              כל הלידים שלך
              <br />
              <span className="text-4xl md:text-[5rem] font-bold leading-none">
                במקום אחד
              </span>
            </h2>
            <p className="text-gray-500 text-base md:text-lg mt-4 max-w-xl mx-auto">
              מתחבר לפייסבוק, מייבא מאקסל, ועוזר לסגור יותר עסקאות בלי לפספס אף ליד.
            </p>
          </div>
        }
      >
        <FakeCRMPreview />
      </ContainerScroll>
    </div>
  );
}
