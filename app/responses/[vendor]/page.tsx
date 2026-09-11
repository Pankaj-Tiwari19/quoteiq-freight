import Link from "next/link";
import { Fragment } from "react";
import { buildDataset } from "@/lib/normalize";
import { parseVendorDoc, documentText } from "@/lib/parse";
import { inr, unitLabel, reasonLabel, fmtLabel, basisLabel } from "@/lib/format";
import ExtractButton from "@/components/ExtractButton";
import DecisionControl from "@/components/DecisionControl";
import ClarifyButton from "@/components/ClarifyButton";

export const dynamic = "force-dynamic";

export default async function VendorPage({
  params,
}: {
  params: Promise<{ vendor: string }>;
}) {
  const { vendor } = await params;
  const ds = buildDataset();
  const v = ds.vendors.find((x) => x.id === vendor);

  if (!v) return <div className="empty">Unknown vendor.</div>;

  const s = ds.summaries.find((x) => x.vendor_id === v.id)!;
  const ex = ds.extractions[v.id];
  const rows = ds.normalized.filter((n) => n.vendor_id === v.id);

  const parsed = await parseVendorDoc(v);
  const isPdf =
    parsed.kind === "image" && parsed.media_type === "application/pdf";
  const text =
    parsed.kind === "text"
      ? parsed.text
      : isPdf
        ? await documentText(v)
        : "";

  return (
    <>
      <h1>{v.name}</h1>

      <p className="sub">
        {v.location}. Responded by {fmtLabel[v.response_format]} on{" "}
        {v.received_on}:{" "}
        <a href={`/api/docs/${v.file}`} target="_blank">
          {v.file}
        </a>
        {v.attachments?.map((a) => (
          <span key={a}>
            {" "}
            · attachment{" "}
            <a href={`/api/docs/${a}`} target="_blank">
              {a}
            </a>
          </span>
        ))}
        . <ExtractButton
          vendorId={v.id}
          label={s.extracted ? "Re-extract" : "Extract now"}
        />
      </p>

      <div className="two">
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>
            Layer 2 · What the vendor sent
          </h2>

          {parsed.kind === "image" && !isPdf ? (
            <img
              src={`/api/docs/${v.file}`}
              alt="Photographed rate card"
              style={{
                width: "100%",
                border: "1px solid var(--line)",
              }}
            />
          ) : (
            <pre
              className="mono"
              style={{
                whiteSpace: "pre-wrap",
                maxHeight: 420,
                overflow: "auto",
                margin: 0,
              }}
            >
              {text}
            </pre>
          )}

          <p
            className="sub"
            style={{ marginTop: 8, fontSize: 12 }}
          >
            {parsed.note}{" "}
            {isPdf
              ? "The PDF itself is what the model reads; this is its text rendering."
              : "This is the exact input given to the extraction model."}
          </p>
        </div>

        <div className="panel">
          <h2 style={{ marginTop: 0 }}>
            Extraction summary · Layer 3
          </h2>

          {!ex ? (
            <div className="empty">Not extracted yet.</div>
          ) : (
            <table>
              <tbody>
                <tr>
                  <td>Currency</td>
                  <td>
                    {s.currency}
                    {/USD/.test(s.currency) && (
                      <>
                        {" "}
                        <small>
                          → INR at {ds.rfq.fx.USD_INR ?? "no rate entered"} (
                          {ds.rfq.fx.source})
                        </small>
                      </>
                    )}
                  </td>
                </tr>

                <tr>
                  <td>Basis</td>
                  <td>
                    <span
                      className={`tag ${
                        s.basis === "all_in"
                          ? "pass"
                          : s.basis === "unstated"
                            ? "muted"
                            : "review"
                      }`}
                    >
                      {basisLabel[s.basis]}
                    </span>{" "}
                    {s.basis !== "all_in" &&
                      s.basis !== "unstated" && (
                        <>
                          <small>
                            – rates are converted but not compared with
                            all-in quotes unless you accept the basis
                            (recorded as an assumption on every lane):
                          </small>
                          <DecisionControl
                            vendorId={v.id}
                            target={{ kind: "basis" }}
                            existing={s.basis_decision}
                            originalLabel={basisLabel[
                              s.basis
                            ].toLowerCase()}
                          />
                        </>
                      )}
                  </td>
                </tr>

                <tr>
                  <td>Volume discount</td>
                  <td>
                    {s.discount ? (
                      <>
                        {s.discount.pct}% above{" "}
                        {s.discount.threshold ?? "?"}{" "}
                        {s.discount.unit ?? ""}{" "}
                        {s.discount.applied ? (
                          <span className="tag pass">
                            applied to FCL lanes (programme{" "}
                            {ds.programme_teu} TEU)
                          </span>
                        ) : (
                          <span className="tag review">
                            not applied
                          </span>
                        )}
                        <br />
                        <small>“{s.discount.text}”</small>
                      </>
                    ) : (
                      "None found"
                    )}
                  </td>
                </tr>

                <tr>
                  <td>Transit / free days</td>
                  <td>
                    {s.transit_days_max != null
                      ? <>
                          up to {s.transit_days_max} days{" "}
                          {ds.rfq.max_transit_days != null &&
                            s.transit_days_max >
                              ds.rfq.max_transit_days && (
                              <span className="tag review">
                                exceeds {ds.rfq.max_transit_days}
                              </span>
                            )}
                        </>
                      : "not stated per lane"}

                    {ex.conditions
                      .filter(
                        (c) =>
                          c.kind === "free_days" ||
                          c.kind === "transit_time"
                      )
                      .map((c, i) => (
                        <Fragment key={i}>
                          <br />
                          <small>{c.text}</small>
                        </Fragment>
                      ))}
                  </td>
                </tr>

                <tr>
                  <td>Coverage</td>
                  <td>
                    {s.lines_quoted}/{ds.rfq.lines.length} lanes
                    {s.lines_missing.length > 0 && (
                      <>
                        {" "}
                        · missing{" "}
                        <span className="mono">
                          {s.lines_missing.join(", ")}
                        </span>
                      </>
                    )}
                  </td>
                </tr>

                <tr>
                  <td>Conditions read</td>
                  <td>
                    {ex.conditions.length ? (
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 16,
                        }}
                      >
                        {ex.conditions.map((c, i) => (
                          <li key={i}>
                            <b>{c.kind.replace("_", " ")}</b>
                            {c.evidence.page
                              ? ` (p.${c.evidence.page})`
                              : ""}
                            : <small>{c.text}</small>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>

                <tr>
                  <td>Attachments read</td>
                  <td>
                    {ex.docSummaries.length
                      ? ex.docSummaries
                          .map(
                            (d) => `${d.file}: ${d.kind}`
                          )
                          .join("; ")
                      : "—"}
                  </td>
                </tr>

                <tr>
                  <td>Reading notes</td>
                  <td>
                    <small>
                      {ex.readingNotes || "—"}
                    </small>
                  </td>
                </tr>

                <tr>
                  <td>Model</td>
                  <td className="mono">
                    {ex.model} · {ex.extracted_at}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          <h2>
            Questionnaire{" "}
            <small
              style={{
                fontWeight: 400,
                color: "var(--muted)",
              }}
            >
              · answers read from the response; pass/fail decided by
              the RFQ rules in code
            </small>
          </h2>

          {v.questionnaire_note && (
            <div className="callout">
              {v.questionnaire_note}
            </div>
          )}

          {!ex ? (
            <div className="empty">
              Assessed after extraction.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th>What the vendor said</th>
                  <th>Read as</th>
                  <th>Decision</th>
                </tr>
              </thead>

              <tbody>
                {s.quality.answers.map((a) => (
                  <tr
                    key={a.criterion_id}
                    className={
                      a.review_required
                        ? "cell-review"
                        : ""
                    }
                  >
                    <td>
                      {a.label}
                      {a.mandatory && (
                        <span
                          className="tag primary"
                          style={{ marginLeft: 6 }}
                        >
                          mandatory
                        </span>
                      )}
                    </td>

                    <td>
                      {a.answer_text ? (
                        <>
                          “{a.answer_text}”
                          <br />
                          <small className="mono">
                            {a.source_location}
                          </small>
                        </>
                      ) : (
                        <span className="cell-missing">
                          not addressed
                        </span>
                      )}
                    </td>

                    <td>
                      <span
                        className={`tag ${
                          a.interpreted === "yes"
                            ? "pass"
                            : a.interpreted === "no"
                              ? a.mandatory
                                ? "fail"
                                : "muted"
                              : "review"
                        }`}
                      >
                        {a.interpreted}
                      </span>{" "}
                      <small>
                        {Math.round(
                          a.confidence * 100
                        )}
                        %
                      </small>
                    </td>

                    <td>
                      {(a.mandatory &&
                        a.interpreted !== "yes") ||
                      a.review_required ? (
                        <DecisionControl
                          vendorId={v.id}
                          target={{
                            kind: "questionnaire",
                            criterion_id:
                              a.criterion_id,
                          }}
                          existing={a.decision}
                          originalLabel={a.interpreted}
                        />
                      ) : a.decision ? (
                        <DecisionControl
                          vendorId={v.id}
                          target={{
                            kind: "questionnaire",
                            criterion_id:
                              a.criterion_id,
                          }}
                          existing={a.decision}
                          originalLabel={a.interpreted}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {ex && (
            <div
              className={`callout ${
                s.quality.passed_mandatory
                  ? "pass"
                  : "fail"
              }`}
              style={{ marginBottom: 0 }}
            >
              {s.quality.passed_mandatory ? (
                "Passes all mandatory criteria."
              ) : (
                <>
                  {s.quality.failed_criteria.length > 0 &&
                    `Fails mandatory: ${s.quality.failed_criteria.join(
                      ", "
                    )}. `}
                  {s.quality.criteria_needing_review.length >
                    0 &&
                    `Low-confidence "yes" on mandatory: ${s.quality.criteria_needing_review.join(
                      ", "
                    )} – confirm before relying on it. `}
                  Excluded from questionnaire-constrained
                  recommendations until resolved (the buyer can
                  accept or override an answer with a reason).
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {ex && (
        <>
          <h2>
            Extracted lane rates (
            {
              rows.filter(
                (r) =>
                  r.review_required &&
                  !r.review_reasons.includes(
                    "missing_quote"
                  )
              ).length
            }{" "}
            need review)
          </h2>

          <div
            className="panel"
            style={{ marginBottom: 12 }}
          >
            <ClarifyButton
              vendorId={v.id}
              count={
                rows.filter(
                  (r) =>
                    r.review_required &&
                    !r.review_reasons.includes(
                      "missing_quote"
                    ) &&
                    !(
                      r.decision &&
                      r.decision.action !== "clarify"
                    )
                ).length +
                s.lines_missing.length +
                s.quality.answers.filter(
                  (a) =>
                    a.interpreted === "unanswered" ||
                    a.interpreted === "partial" ||
                    a.review_required
                ).length
              }
            />
          </div>

          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Lane</th>
                  <th>As quoted</th>
                  <th className="num">
                    Converted ₹/unit
                  </th>
                  <th className="num">
                    Comparable ₹/unit
                  </th>
                  <th>Confidence</th>
                  <th>Evidence</th>
                  <th>Review</th>
                  <th>Decision</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((n) => (
                  <tr
                    key={n.sku}
                    className={
                      n.review_required &&
                      !n.review_reasons.includes(
                        "missing_quote"
                      )
                        ? "cell-review"
                        : ""
                    }
                  >
                    <td className="mono">
                      <Link
                        href={`/comparison?sku=${n.sku}`}
                      >
                        {n.sku}
                      </Link>
                    </td>

                    <td>
                      {n.original_value == null ? (
                        <span className="cell-missing">
                          {n.review_reasons.includes(
                            "missing_quote"
                          )
                            ? "not quoted"
                            : reasonLabel[
                                n.review_reasons[0]
                              ] ?? "no number"}
                        </span>
                      ) : (
                        <>
                          {n.original_value}{" "}
                          {n.original_currency}{" "}
                          <small>
                            {unitLabel(n.original_unit)}
                          </small>{" "}
                          <small className="tag muted">
                            {basisLabel[n.basis]}
                          </small>
                        </>
                      )}

                      {n.assumptions.length > 0 && (
                        <>
                          <br />
                          <small
                            style={{
                              color: "var(--muted)",
                            }}
                          >
                            assumes:{" "}
                            {n.assumptions.join("; ")}
                          </small>
                        </>
                      )}
                    </td>

                    <td className="num">
                      {inr(n.normalized_value)}

                      {n.calculation_trace.length > 0 && (
                        <details>
                          <summary
                            style={{
                              cursor: "pointer",
                              fontSize: 11,
                              color: "var(--muted)",
                            }}
                          >
                            how
                          </summary>

                          <ul className="trace">
                            {n.calculation_trace.map(
                              (t, i) => (
                                <li key={i}>{t}</li>
                              )
                            )}
                          </ul>
                        </details>
                      )}
                    </td>

                    <td className="num">
                      {n.comparable_value == null &&
                      n.normalized_value != null ? (
                        <span className="tag review">
                          not comparable
                        </span>
                      ) : (
                        inr(n.comparable_value)
                      )}
                    </td>

                    <td>
                      {n.review_reasons.includes(
                        "missing_quote"
                      ) ? (
                        "—"
                      ) : (
                        <>
                          {n.confidence_label}
                          <span
                            className={`conf ${
                              n.confidence < 0.8
                                ? "low"
                                : ""
                            }`}
                          >
                            <i
                              style={{
                                width: `${
                                  n.confidence * 100
                                }%`,
                              }}
                            />
                          </span>
                        </>
                      )}
                    </td>

                    <td>
                      <small className="mono">
                        {n.source_location}
                      </small>

                      {n.raw_text && (
                        <>
                          <br />
                          <small>
                            “{n.raw_text.slice(0, 120)}”
                          </small>
                        </>
                      )}

                      {n.evidence_box && (
                        <>
                          <br />
                          <a
                            href={`/api/docs/${v.file}`}
                            target="_blank"
                          >
                            <small>
                              region x{n.evidence_box.x} y
                              {n.evidence_box.y}
                            </small>
                          </a>
                        </>
                      )}
                    </td>

                    <td>
                      {n.review_reasons.map((r) => (
                        <span
                          key={r}
                          className={`tag ${
                            r === "missing_quote"
                              ? "muted"
                              : "review"
                          }`}
                          style={{ marginRight: 4 }}
                        >
                          {reasonLabel[r]}
                        </span>
                      ))}

                      {n.review_note &&
                        n.original_value != null && (
                          <>
                            <br />
                            <small>
                              {n.review_note}
                            </small>
                          </>
                        )}
                    </td>

                    <td>
                      {(n.review_reasons.length > 0 &&
                        !n.review_reasons.includes(
                          "missing_quote"
                        )) ||
                      n.decision ? (
                        <DecisionControl
                          vendorId={v.id}
                          target={{
                            kind: "line",
                            sku: n.sku,
                          }}
                          existing={n.decision}
                          originalLabel={`${n.original_value ?? "—"} ${n.original_currency} ${unitLabel(
                            n.original_unit
                          )}`}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}