// Example data for the landing page only. Real OpenAlex counts, not invented.
// Source: api.openalex.org/works?filter=title_and_abstract.search:<topic>,publication_year:2010-2026&group_by=publication_year
// Fetched on 2 Nov 2026. 2026 is year to date (partial year), so show it dashed like the report chart.
// To refresh: rerun the query above for each topic and replace the counts.
window.LANDING_EXAMPLES = {
  fetched: "2026-11-02",
  partialYear: 2026,
  hero: "agentic ai",
  topics: [
    {
      id: "agentic ai",
      name: "Agentic AI",
      query: "agentic AI",
      years: { 2010: 1, 2011: 2, 2012: 0, 2013: 2, 2014: 5, 2015: 6, 2016: 5, 2017: 21, 2018: 7, 2019: 17, 2020: 13, 2021: 14, 2022: 19, 2023: 74, 2024: 184, 2025: 2572, 2026: 10566 }
    },
    {
      id: "neurotechnology",
      name: "Neurotechnology",
      query: "neurotechnology",
      years: { 2010: 65, 2011: 246, 2012: 86, 2013: 95, 2014: 150, 2015: 108, 2016: 143, 2017: 127, 2018: 147, 2019: 192, 2020: 219, 2021: 263, 2022: 315, 2023: 329, 2024: 411, 2025: 805, 2026: 1177 }
    },
    {
      id: "epigenetics",
      name: "Epigenetics",
      query: "epigenetics",
      years: { 2010: 6505, 2011: 7666, 2012: 9041, 2013: 10326, 2014: 11148, 2015: 12396, 2016: 13450, 2017: 13463, 2018: 13746, 2019: 15046, 2020: 15257, 2021: 15725, 2022: 16373, 2023: 21725, 2024: 18076, 2025: 23369, 2026: 27529 }
    }
  ]
};
