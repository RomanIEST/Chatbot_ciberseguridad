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
    if (typeof claim.quote !== "string" || !claim.quote.trim()) {
      errors.push(`${label}: falta un extracto verificable.`);
    } else {
      const quote = normalizeLegalText(claim.quote);
      const sourceText = normalizeLegalText(source.text);
      if (quote.length > 800) {
        errors.push(`${label}: el extracto supera 800 caracteres.`);
      }
      if (!quote || !sourceText.includes(quote)) {
        errors.push(
          `${label}: el extracto no coincide literalmente con ${source.id}.`,
        );
      }
    }

    const actualReferences = extractArticleReferences(claim.statement);
    const declaredReferences = Array.isArray(claim.article_references)
      ? claim.article_references.map((reference) =>
        normalizeLegalText(reference)
      )
      : [];
    if (!Array.isArray(claim.article_references)) {
      errors.push(`${label}: article_references debe ser una lista.`);
    }
    const missingDeclarations = actualReferences.filter((reference) =>
      !declaredReferences.includes(reference)
    );
    const extraDeclarations = declaredReferences.filter((reference) =>
      !actualReferences.includes(reference)
    );
    if (missingDeclarations.length) {
      errors.push(
        `${label}: referencias no declaradas (${
          missingDeclarations.join(", ")
        }).`,
      );
    }
    if (extraDeclarations.length) {
      errors.push(
        `${label}: referencias declaradas que no aparecen en el texto (${
          extraDeclarations.join(", ")
        }).`,
      );
    }
    for (const reference of actualReferences) {
      if (!articleAppearsInEvidence(reference, claim.quote || "")) {
        errors.push(
          `${label}: el extracto no muestra el encabezado del artículo ${reference}.`,
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
