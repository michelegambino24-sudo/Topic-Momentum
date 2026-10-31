// Fictional sample. Entries follow SPEC.md Section 4 without extra fields.
window.SAMPLE_LIBRARY = [
  {
    id: "lunar moss computing|moon moss circuits|lunar bryophyte logic",
    name: "lunar moss computing",
    synonyms: ["moon moss circuits", "lunar bryophyte logic"],
    field: "Computer Science",
    momentum: "Accelerating",
    growth: 0.33385376024181124,
    total: 3645,
    updated: "2026-10-31",
    parent: null,
    children: ["low-gravity logic gates", "moss memory arrays"]
  },
  {
    id: "low-gravity logic gates", name: "Low-gravity logic gates", synonyms: [],
    field: "Computer Science", momentum: "Accelerating", growth: 0.27,
    total: 490, updated: "2026-10-30",
    parent: "lunar moss computing|moon moss circuits|lunar bryophyte logic", children: []
  },
  {
    id: "moss memory arrays", name: "Moss memory arrays", synonyms: [],
    field: "Computer Science", momentum: "Growing", growth: 0.16,
    total: 635, updated: "2026-10-29",
    parent: "lunar moss computing|moon moss circuits|lunar bryophyte logic", children: []
  }
];
