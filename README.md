# Fieldnotes

Companion to **A Computational Map of the Disaster Mental Health Research Landscape**, by Soheil Shapouri and Saber Soleymani.

Explore the literature through filters, charts, article records, metadata downloads, and the manuscript. AI synthesis is optional; the explorer works without credentials.

## Development

Requires Node.js 22 or newer. No npm dependencies or database are required.

```sh
npm run dev
```

Open http://localhost:3000. Run `npm test` for checks and `npm run build` to generate `dist/`.

## Deployment

Deploy the project root to Vercel with the **Other** framework preset. `vercel.json` configures the build, static output, and API function. Configure optional AI credentials server-side.

## Data notes

- Includes 7,859 source records; the default analysis corpus contains 5,614 articles after duplicate, parsing-error, and relevance exclusions.
- Categories can overlap. Publication counts describe research attention, not evidence quality, prevalence, or treatment effects.
- Data for 2026 are partial through May. Participant country differs from author affiliation; sample-size units may vary.
- Prepared records and the manuscript in `public/` are included in the repository and deployed site.
