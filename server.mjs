import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  groundedAnswerFormat,
  renderGroundedAnswer,
  validateGroundedAnswer,
} from "./lib/grounded_answers.mjs";

const app = express();
const port = Number(process.env.PORT || 3000);
const vectorStoreId =
  (process.env.VECTOR_STORE_ID || process.env.VECTOR_STORE || "").trim();
const model = (process.env.OPENAI_MODEL || "gpt-4.1-mini").trim();
const apiKey = (process.env.OPENAI_API_KEY || "").trim();
const dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.join(dirname, "config", "legal-rules.md");

if (!apiKey) throw new Error("Falta OPENAI_API_KEY en .env");
if (!vectorStoreId) {
  throw new Error("Falta VECTOR_STORE o VECTOR_STORE_ID en .env");
}

const openai = new OpenAI({ apiKey });
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(dirname, "public")));

const noEvidenceAnswer =
  "No encontré fragmentos pertinentes en el Vector Store. No puedo fundamentar una respuesta jurídica sin una fuente documental recuperada.";

app.post("/api/chat", async (req, res) => {
  const question = typeof req.body?.question === "string"
    ? req.body.question.trim()
    : "";
  const previousResponseId = typeof req.body?.previous_response_id === "string"
    ? req.body.previous_response_id
    : undefined;

  if (!question) {
    return res.status(400).json({ error: "Escribe una pregunta." });
  }

  try {
    const legalRules = await readFile(rulesPath, "utf8");

    const search = await openai.vectorStores.search(vectorStoreId, {
      query: question,
      max_num_results: 12,
      rewrite_query: true,
    });

    const sources = (search.data || [])
      .map((result, index) => {
        const filename = 
          result.filename || 
          result.attributes?.filename || 
          result.file_id || 
          `Documento_${index + 1}.pdf`;

        return {
          id: `S${index + 1}`,
          filename: filename,
          score: result.score,
          text: (result.content || [])
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
            .trim(),
        };
      })
      .filter((source) => source.text);

    if (sources.length === 0) {
      return res.json({ answer: noEvidenceAnswer, sources: [] });
    }

    const evidence = sources.map((source) =>
      `[${source.id}] Archivo: ${source.filename}\nFragmento recuperado:\n${source.text}`
    ).join("\n\n---\n\n");

    const response = await openai.responses.create({
      model,
      ...(previousResponseId
        ? { previous_response_id: previousResponseId }
        : {}),
      instructions: [
        "Eres un asistente de investigación jurídica y ciberseguridad enfocado en México.",
        "Genera una respuesta completa y estructurada abordando todos los aspectos relevantes encontrados en la evidencia.",
        "Para cada afirmación importante en 'claims', asigna el source_id correspondiente (ej. S1, S2) y copia un extracto continuo y literal en 'quote'.",
        legalRules,
      ].join("\n\n"),
      input:
        `Pregunta del usuario:\n${question}\n\nFragmentos documentales recuperados del Vector Store:\n\n${evidence}`,
      text: { format: groundedAnswerFormat },
      max_output_tokens: 2200,
    });

    let payload = null;
    try {
      payload = JSON.parse(response.output_text || "");
    } catch {
      payload = null;
    }

    const validation = validateGroundedAnswer(payload, sources);

    // Muestra todas las afirmaciones procesadas
    let answer = renderGroundedAnswer(payload);

    res.json({
      answer,
      response_id: response.id,
      sources: sources.map((source) => `[${source.id}] ${source.filename}`),
      citation_check: { passed: validation.valid, errors: validation.errors },
    });
  } catch (error) {
    console.error("Error al consultar OpenAI:", error?.message || error);
    res.status(500).json({
      error: "No se pudo consultar el vector store. Revisa la configuración.",
    });
  }
});

app.listen(port, () => {
  console.log(`Chatbot disponible en http://localhost:${port}`);
});