// Prompt text for the "Copy for ChatGPT" button. {{CONTENT}} is replaced with the report's numbers and names.
// Keep this file free of client names. Only Strategy& may be mentioned.
globalThis.TMM_CHATGPT_PROMPT = `Generate four options in an image, showing FOUR distinct, professionally designed 16:9 PowerPoint slide concepts based on the content provided below.

CRITICAL INSTRUCTIONS — READ FIRST
1. Use IMAGE GENERATION ONLY. Do not use PowerPoint tools, slide-building skills, Python or code.
2. Generate ONE high-resolution image containing FOUR complete slide designs arranged in a 2×2 grid.
3. DO NOT request reference images, screenshots, slide templates, brand guidelines or any additional files.
4. This prompt is FULLY SELF-CONTAINED. All necessary visual styling instructions are provided below.
5. The requested design style is inspired by premium Strategy& consulting presentations. You do not need access to any actual Strategy& slides.
6. Interpret the design specifications directly and make appropriate creative decisions independently.
7. If any visual detail is unspecified, use a sophisticated consulting-style default rather than asking questions.
8. Do not generate a PPTX. The final output must be an IMAGE, not an editable presentation.
9. Follow the two steps in PROCESS below: ask first, then generate.

PROCESS — TWO STEPS
STEP 1 (now): Do NOT generate the image yet. Read the CONTENT and reply ONLY with a numbered checklist of the information blocks you found (headline, papers published, growth, key experts, key papers, top places, sub-topics, top journals). For each block, say what is available and what you propose to keep by default: 2 experts, 2 key papers, 3 places, 3 sub-topics, unless I say otherwise. Then end with exactly these instructions:
- "To keep only some blocks, reply with their numbers (for example: 1,2,3)."
- "To choose specific items, name them (for example: an expert, a sub-topic or a journal from the CONTENT)."
- "Say GO to use the defaults."
Then stop and wait.
STEP 2 (after my reply): Generate the image exactly as specified below, using only the blocks and items I approved. No explanations, no further questions.

VISUAL IDENTITY
Create slides with Strategy&-level consulting precision and a welcoming, sophisticated visual identity.
Use:
- White backgrounds and large muted teal (#558C7E) headlines.
- Small black uppercase subtitles.
- Deep navy (#25215C) section headers.
- Pastel mint (#DDEBE6), light blue (#DCEEF4), soft pink (#F2CED9) and warm yellow (#FFDB55) accents.
- Rounded light-grey content cards with subtle shadows.
- Clean sans-serif typography, strong information hierarchy and selective bold formatting.
- Thin teal line icons with consistent stroke thickness.
- Small flat-vector illustrations relevant to the topic (relevant scientific, economic or social concepts).
- Rounded illustration shapes, minimal facial details, soft pastel colours and small decorative stars or abstract curves.
- Consistent alignment, generous margins, precise spacing and structured information groups.

SLIDE STRUCTURE
Every slide must feature a meaningful insight-led headline, clearly organised content sections, prominent key statistics where supplied, supporting analytical visuals and an uncluttered executive-level layout.
For research content, use appropriate combinations of publication-growth charts, subtopic cards, expert panels, mini-diagrams of the topic's key concepts and key-insight sections.
Maintain accurate data labels and preserve all essential information. Copy every number and name exactly as given. Do not invent, estimate or round anything. If data is missing, leave it out.

FOUR DISTINCT OPTIONS
- Option 1 — Classic Consulting: Structured two-column layout, clean charts and organised content blocks.
- Option 2 — Visual Storytelling: Engaging pastel cards, small illustrations and an intuitive narrative flow.
- Option 3 — Data-Driven: Prominent research-growth chart, KPI highlights, expert information and compact subtopic cards.
- Option 4 — Creative Framework: Central conceptual illustration or diagram connected to structured information sections.
All four options must use the same colour palette and illustration language but feature genuinely different layouts.

FINAL QUALITY CHECK
Ensure each design is a complete 16:9 slide with correctly rendered text, precise alignment, consistent typography, readable labels, accurate numbers, no overlapping elements and no cropped content.
The result should resemble a polished consulting slide created for a high-level presentation, not a generic infographic, poster or AI-generated marketing graphic.
GENERATE THE IMAGE ONLY AFTER STEP 1 HAS BEEN ANSWERED.

CONTENT:
{{CONTENT}}`;
