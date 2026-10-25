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

/**
 * Normaliza retornos de carro (\r\n) y espacios dobles
 * para asegurar la misma lectura en Linux (Render) y Windows.
 */
function cleanWhitespace(str) {
  if (!str) return "";
  return str
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateGroundedAnswer(payload, sources) {
  const errors = [];
  const allowedStatus = new Set(["respondido", "parcial", "abstencion"]);
  const allowedCategories = new Set(Object.keys(categories));
  const sourceMap = new Map(sources.map((source) => [source.id, source]));

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
    const source = sourceMap.get(claim.source_id);
    if (!source) {
      errors.push(`${label}: fuente desconocida (${String(claim.source_id)}).`);
      return;
    }
    sourceIds.add(source.id);

    // --- VERIFICACIÓN DE CITA FLEXIBLE Y RESISTENTE A ENTORNO LINUX/RENDER ---
    if (typeof claim.quote !== "string" || !claim.quote.trim()) {
      errors.push(`${label}: falta un extracto verificable.`);
    } else {
      const quote = cleanWhitespace(normalizeLegalText(claim.quote));
      const sourceText = cleanWhitespace(normalizeLegalText(source.text));

      if (claim.quote.length > 800) {
        errors.push(`${label}: el extracto supera 800 caracteres.`);
      }
      if (!quote || !sourceText.includes(quote)) {
        errors.push(
          `${label}: el extracto no coincide literalmente con ${source.id}.`,
        );
      }
    }

    if (!Array.isArray(claim.article_references)) {
      errors.push(`${label}: article_references debe ser una lista.`);
    }

    // --- VERIFICACIÓN DE ARTÍCULOS SIN BLOQUEOS POR DECLARACIONES EXTRA ---
    const actualReferences = extractArticleReferences(claim.statement);

    for (const reference of actualReferences) {
      const cleanSource = cleanWhitespace(normalizeLegalText(source.text));
      const cleanQuote = cleanWhitespace(normalizeLegalText(claim.quote || ""));
      const normalizedRef = normalizeLegalText(reference);

      // Comprueba si el artículo existe en la cita O en el fragmento completo recuperado
      const inQuote = articleAppearsInEvidence
        ? articleAppearsInEvidence(reference, cleanQuote)
        : cleanQuote.includes(normalizedRef);
      const inSource = cleanSource.includes(normalizedRef);

      if (!inQuote && !inSource) {
        errors.push(
          `${label}: el extracto/fuente no muestra la referencia del artículo ${reference}.`,
        );
      }
    }

    if (/\[S\d+\]/u.test(claim.statement)) {
      errors.push(
        `${label}: no escribas etiquetas de fuente dentro del texto; usa source_id.`,
      );
    }
  });

  return { valid: errors.length === 0, errors, sourceIds: [...sourceIds] };
}

export function renderGroundedAnswer(payload) {
  const claims = Array.isArray(payload?.claims) ? payload.claims : [];
  if (payload?.status === "abstencion" && claims.length === 0) {
    return "No encontré en los fragmentos recuperados fundamento suficiente para responder con seguridad. No voy a completar la respuesta con información no verificada.";
  }
  if (!claims.length) {
    return "No puedo responder con seguridad a partir de los fragmentos recuperados.";
  }

  const rendered = claims.map((claim) => {
    const category = categories[claim.category] || categories.interpretacion;
    return `${category}: ${claim.statement} [${claim.source_id}]\nExtracto verificado: “${claim.quote}”`;
  });
  if (payload.status === "parcial" || payload.status === "abstencion") {
    rendered.push(
      "Los fragmentos no permiten resolver el resto de la pregunta; hace falta consultar la fuente o dato aplicable.",
    );
  }
  return rendered.join("\n\n");
}