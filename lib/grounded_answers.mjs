import {
  articleAppearsInEvidence,
  extractArticleReferences,
  normalizeLegalText,
} from "./legal_references.mjs";

export const groundedAnswerFormat = {
  type: "json_schema",
  name: "grounded_legal_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["respondido", "parcial", "abstencion"],
      },
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            statement: { type: "string" },
            category: {
              type: "string",
              enum: [
                "texto_expreso",
                "interpretacion",
                "recomendacion",
                "limite",
              ],
            },
            source_id: { type: "string" },
            quote: { type: "string" },
            article_references: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "statement",
            "category",
            "source_id",
            "quote",
            "article_references",
          ],
        },
      },
    },
    required: ["status", "claims"],
  },
};

const categories = {
  texto_expreso: "Texto expreso",
  interpretacion: "Interpretación",
  recomendacion: "Recomendación práctica",
  limite: "Límite de verificación",
};

function cleanTextForMatching(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/[^\w\xa0-\xff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateGroundedAnswer(payload, sources) {
  const errors = [];
  const allowedStatus = new Set(["respondido", "parcial", "abstencion"]);
  const allowedCategories = new Set(Object.keys(categories));

  const sourceMap = new Map();
  sources.forEach((source) => {
    sourceMap.set(source.id, source);
    if (source.filename) {
      sourceMap.set(source.filename, source);
      sourceMap.set(source.filename.toLowerCase(), source);
    }
  });

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      valid: false,
      errors: ["La salida no es un objeto JSON."],
      sourceIds: [],
    };
  }
  if (!allowedStatus.has(payload.status)) {
    errors.push("Estado de respuesta inválido.");
  }
  if (!Array.isArray(payload.claims)) {
    errors.push("Falta la lista de afirmaciones.");
  }
  const claims = Array.isArray(payload.claims) ? payload.claims : [];
  if (payload.status === "respondido" && claims.length === 0) {
    errors.push(
      "El estado respondido requiere al menos una afirmación respaldada.",
    );
  }

  const sourceIds = new Set();
  claims.forEach((claim, index) => {
    const label = `Afirmación ${index + 1}`;
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      errors.push(`${label}: formato inválido.`);
      return;
    }
    if (typeof claim.statement !== "string" || !claim.statement.trim()) {
      errors.push(`${label}: falta el texto.`);
      return;
    }
    if (!allowedCategories.has(claim.category)) {
      errors.push(`${label}: categoría inválida.`);
    }

    const rawSourceKey = String(claim.source_id || "").trim();
    const source = sourceMap.get(rawSourceKey) || sourceMap.get(rawSourceKey.toLowerCase());

    if (!source) {
      errors.push(`${label}: fuente desconocida (${rawSourceKey}).`);
      return;
    }
    sourceIds.add(source.id);

    if (typeof claim.quote !== "string" || !claim.quote.trim()) {
      errors.push(`${label}: falta un extracto verificable.`);
    } else {
      const cleanQuote = cleanTextForMatching(claim.quote);
      const cleanSource = cleanTextForMatching(source.text);

      if (claim.quote.length > 800) {
        errors.push(`${label}: el extracto supera 800 caracteres.`);
      }

      const isMatch = cleanSource.includes(cleanQuote) || 
                      (cleanQuote.length > 30 && cleanSource.includes(cleanQuote.substring(0, 30)));

      if (!cleanQuote || !isMatch) {
        errors.push(
          `${label}: el extracto no coincide literalmente con ${source.id}.`,
        );
      }
    }

    if (!Array.isArray(claim.article_references)) {
      errors.push(`${label}: article_references debe ser una lista.`);
    }
  });

  return { valid: errors.length === 0, errors, sourceIds: [...sourceIds] };
}

export function renderGroundedAnswer(payload) {
  const claims = Array.isArray(payload?.claims) ? payload.claims : [];
  if (payload?.status === "abstencion" && claims.length === 0) {
    return "No encontré en los fragmentos recuperados fundamento suficiente para responder a la consulta.";
  }
  if (!claims.length) {
    return "No puedo responder con seguridad a partir de los fragmentos recuperados.";
  }

  const intro = "Con base en la normativa recuperada del Vector Store, se resumen las principales disposiciones aplicables:\n\n";

  const body = claims.map((claim, idx) => {
    return `${idx + 1}. **${claim.statement}**\n   > *Fuente (${claim.source_id}):* "${claim.quote}"`;
  }).join("\n\n");

  let outro = "";
  if (payload.status === "parcial" || payload.status === "abstencion") {
    outro = "\n\n*Nota: La información recuperada cubre parcialmente la consulta. Se sugiere revisar el articulado completo en las fuentes indicadas.*";
  }

  return intro + body + outro;
}