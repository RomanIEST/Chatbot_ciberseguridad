import test from "node:test";
import assert from "node:assert/strict";
import {
  articleAppearsInEvidence,
  extractArticleReferences,
} from "../lib/legal_references.mjs";
import {
  groundedAnswerFormat,
  renderGroundedAnswer,
  validateGroundedAnswer,
} from "../lib/grounded_answers.mjs";

test("extracts ordinary references with accents and abbreviations", () => {
  assert.deepEqual(extractArticleReferences("Artículo 18 y art. 31"), [
    "18",
    "31",
  ]);
});

test("keeps bis article numbers distinct", () => {
  assert.deepEqual(
    extractArticleReferences("artículo 211 bis 2; artículo 211 bis 3"),
    ["211 bis 2", "211 bis 3"],
  );
});

test("extracts a short list of references", () => {
  assert.deepEqual(extractArticleReferences("artículos 25 y 26"), ["25", "26"]);
});

test("does not treat a following year as part of the article number", () => {
  assert.deepEqual(
    extractArticleReferences("artículo 19, reforma publicada en 2025"),
    ["19"],
  );
});

test("requires the exact bis provision to appear in evidence", () => {
  const source =
    "Artículo 211 bis 2.- Al que sin autorización copie información del Estado.";
  assert.equal(articleAppearsInEvidence("211 bis 2", source), true);
  assert.equal(articleAppearsInEvidence("211 bis 3", source), false);
});

test("does not match an unrelated article number", () => {
  const source =
    "Artículo 19: informar vulneraciones. Artículo 31: atender solicitudes ARCO.";
  assert.equal(articleAppearsInEvidence("31", source), true);
  assert.equal(articleAppearsInEvidence("25", source), false);
});

const articleSource = {
  id: "S1",
  filename: "CPF.pdf",
  text:
    "Artículo 211 bis 2.- Al que sin autorización copie información del Estado.",
};

test("accepts a literal quote linked to the exact bis article", () => {
  const payload = {
    status: "respondido",
    claims: [{
      statement: "El artículo 211 bis 2 contempla la copia sin autorización.",
      category: "texto_expreso",
      source_id: "S1",
      quote: articleSource.text,
      article_references: ["211 bis 2"],
    }],
  };
  assert.equal(validateGroundedAnswer(payload, [articleSource]).valid, true);
  assert.match(renderGroundedAnswer(payload), /\[S1\]/);
});

test("rejects a citation to a source identifier that was not retrieved", () => {
  const payload = {
    status: "respondido",
    claims: [{
      statement: "El artículo 211 bis 2 contempla la copia sin autorización.",
      category: "texto_expreso",
      source_id: "S2",
      quote: articleSource.text,
      article_references: ["211 bis 2"],
    }],
  };
  assert.equal(validateGroundedAnswer(payload, [articleSource]).valid, false);
});

test("rejects a bis 3 claim supported only by bis 2 text", () => {
  const payload = {
    status: "respondido",
    claims: [{
      statement: "El artículo 211 bis 3 contempla la copia sin autorización.",
      category: "texto_expreso",
      source_id: "S1",
      quote: articleSource.text,
      article_references: ["211 bis 3"],
    }],
  };
  assert.equal(validateGroundedAnswer(payload, [articleSource]).valid, false);
});

test("rejects an article mention omitted from article_references", () => {
  const payload = {
    status: "respondido",
    claims: [{
      statement: "El artículo 211 bis 2 contempla la copia sin autorización.",
      category: "texto_expreso",
      source_id: "S1",
      quote: articleSource.text,
      article_references: [],
    }],
  };
  const result = validateGroundedAnswer(payload, [articleSource]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /referencias no declaradas/);
});

test("rejects a paraphrase passed off as a verbatim quote", () => {
  const payload = {
    status: "respondido",
    claims: [{
      statement: "La disposición regula copiar datos sin autorización.",
      category: "interpretacion",
      source_id: "S1",
      quote:
        "El artículo establece penas por copiar archivos sin autorización.",
      article_references: [],
    }],
  };
  assert.equal(validateGroundedAnswer(payload, [articleSource]).valid, false);
});

test("abstention without claims renders a fixed safe response", () => {
  const payload = { status: "abstencion", claims: [] };
  assert.equal(validateGroundedAnswer(payload, [articleSource]).valid, true);
  assert.match(renderGroundedAnswer(payload), /No encontré/);
});

test("uses strict structured output", () => {
  assert.equal(groundedAnswerFormat.strict, true);
  assert.equal(groundedAnswerFormat.type, "json_schema");
});
