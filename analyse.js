(function (root) {
  "use strict";

  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const MOIS_COURT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const pad = (n) => String(n).padStart(2, "0");

  function monthKey(v) {
    if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}`;
    const s = String(v ?? "").trim();
    const m = s.match(/^(\d{4})[-\/](\d{1,2})(?:[-\/]\d{1,2})?(?:[T ].*)?$/);
    if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
    return null;
  }

  function monthLabel(key, short) {
    const [y, m] = key.split("-").map(Number);
    return short ? `${MOIS_COURT[m - 1]} ${String(y).slice(2)}` : `${MOIS[m - 1]} ${y}`;
  }

  function toNum(v) {
    if (typeof v === "number") return isFinite(v) ? v : null;
    const s = String(v ?? "").replace(/[\s\u00a0]/g, "");
    if (!s) return null;
    const n = Number(s.replace(/,/g, "."));
    return isFinite(n) ? n : null;
  }

  const str = (v) => (v == null ? "" : String(v).trim());

  function parseReport(rows) {
    let hdr = -1;
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      if ((rows[i] || []).filter((c) => monthKey(c)).length >= 2) { hdr = i; break; }
    }
    if (hdr < 0) throw new Error("Aucune ligne d'en-tête contenant des mois (format AAAA-MM) n'a été trouvée.");

    const head = rows[hdr];
    const sub = rows[hdr + 1] || [];
    const monthIdx = head.map((c, j) => (monthKey(c) ? j : -1)).filter((j) => j >= 0);
    const subIsHeader = monthIdx.every((j) => typeof sub[j] === "string" || sub[j] == null) &&
      monthIdx.some((j) => str(sub[j]) !== "");

    const seen = new Set();
    const monthCols = [];
    for (const j of monthIdx) {
      const key = monthKey(head[j]);
      const label = subIsHeader ? str(sub[j]) : "";
      if (/change|variation|evol|%|delta/i.test(label) || seen.has(key)) continue;
      seen.add(key);
      monthCols.push({ key, col: j, label });
    }
    monthCols.sort((a, b) => a.key.localeCompare(b.key));
    if (monthCols.length < 2) throw new Error("Il faut au moins deux mois de données pour comparer.");

    const labelRow = subIsHeader ? sub : head;
    const firstMonthCol = Math.min(...monthCols.map((m) => m.col));
    const labelCols = [];
    for (let j = 0; j < firstMonthCol; j++) labelCols.push(j);

    const dataStart = hdr + (subIsHeader ? 2 : 1);
    const filled = (j) => rows.slice(dataStart).some((r) => r && str(r[j]) !== "");

    let nameCol = labelCols.find((j) => /team|publisher|partner|name|nom|client|compte|account|éditeur|editeur|site/i.test(str(labelRow[j])));
    if (nameCol == null) nameCol = [...labelCols].reverse().find(filled);
    if (nameCol == null) throw new Error("Impossible d'identifier la colonne des comptes.");

    let groupCol = labelCols.find((j) => j !== nameCol && /csm|owner|kam|manager|responsable|account manager|\bam\b/i.test(str(labelRow[j])));
    if (groupCol == null) groupCol = labelCols.find((j) => j !== nameCol && filled(j));

    const metric = (monthCols[0].label || "Volume")
      .replace(/^(publisher|advertiser|campaign)\s+agg\s+crb\s+/i, "")
      .trim() || "Volume";

    const entities = [];
    for (let i = dataStart; i < rows.length; i++) {
      const r = rows[i] || [];
      const name = str(r[nameCol]);
      if (!name || /^(grand )?total|^sous-total|^subtotal/i.test(name)) continue;
      const values = monthCols.map((m) => toNum(r[m.col]));
      if (values.every((v) => v == null)) continue;
      entities.push({ name, group: groupCol != null ? str(r[groupCol]) || "—" : null, values });
    }
    if (!entities.length) throw new Error("Aucune ligne de compte exploitable dans ce fichier.");

    const groupLabel = groupCol != null ? str(labelRow[groupCol]) || str(head[groupCol]) || "Groupe" : null;
    return {
      metric,
      months: monthCols.map((m) => m.key),
      entities,
      groupLabel,
      groups: groupCol != null ? [...new Set(entities.map((e) => e.group))].sort((a, b) => a.localeCompare(b, "fr")) : [],
    };
  }

  function fmtVol(n) {
    if (n == null || isNaN(n)) return "—";
    const a = Math.abs(n);
    const f = (x, d) => x.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
    if (a >= 1e9) return `${f(n / 1e9, 1)} Md`;
    if (a >= 1e6) return `${f(n / 1e6, a >= 1e8 ? 0 : 1)} M`;
    if (a >= 1e4) return `${f(n / 1e3, 0)} k`;
    return f(n, 0);
  }

  function fmtPct(p, signed = true) {
    if (p == null || !isFinite(p)) return "—";
    const s = (Math.abs(p) * 100).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    if (!signed) return `${s} %`;
    return `${p > 0 ? "+" : p < 0 ? "−" : ""}${s} %`;
  }

  const fmtDelta = (d) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${fmtVol(Math.abs(d))}`;
  const pct = (a, b) => (b ? (a - b) / b : null);
  const de = (s) => (/^[aeiouyhéèê]/i.test(s) ? `d'${s}` : `de ${s}`);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const b = (s) => `<b>${esc(s)}</b>`;
  const list = (names, max = 3) => {
    const shown = names.slice(0, max).map(b).join(", ");
    return names.length > max ? `${shown} et ${names.length - max} autre${names.length - max > 1 ? "s" : ""}` : shown;
  };

  function streak(values, i, dir) {
    let n = 0;
    for (let k = i; k > 0; k--) {
      const cur = values[k], prev = values[k - 1];
      if (cur == null || prev == null || prev <= 0) break;
      if (dir > 0 ? cur > prev : cur < prev) n++;
      else break;
    }
    return n;
  }

  function analyse(report, opts = {}) {
    const { months, metric } = report;
    const i = Math.min(Math.max(opts.monthIndex ?? months.length - 1, 1), months.length - 1);
    const group = opts.group || null;
    const ents = group ? report.entities.filter((e) => e.group === group) : report.entities;
    const v = (e, k) => e.values[k] ?? 0;

    const totals = months.map((_, k) => ents.reduce((s, e) => s + v(e, k), 0));
    const cur = totals[i], prv = totals[i - 1], first = totals[0];
    const mom = pct(cur, prv);
    const vsStart = i > 1 ? pct(cur, first) : null;
    const isPeak = i >= 2 && totals.slice(0, i + 1).every((t) => t <= cur);
    const M = monthLabel(months[i]);
    const P = monthLabel(months[i - 1]);
    const F = monthLabel(months[0]);
    const unit = metric.toLowerCase();
    const sig = Math.max(1e4, cur * 5e-4);
    const base = prv || cur || 1;

    const rows = ents.map((e) => {
      const c = v(e, i), p = v(e, i - 1);
      return { name: e.name, group: e.group, cur: c, prev: p, delta: c - p, pct: pct(c, p), share: cur ? c / cur : 0, series: e.values.slice(0, i + 1) };
    });
    const active = rows.filter((r) => r.cur > 0).length;

    const H = [], V = [];
    const tag = (r) => (!group && r.group ? ` (${esc(r.group)})` : "");

    if (mom != null && Math.abs(mom) >= 0.01) {
      const txt = `${fmtVol(cur)} ${unit} en ${M}, soit ${fmtDelta(cur - prv)} par rapport à ${P}.`;
      if (mom > 0) H.push({ score: 10, title: isPeak ? "Volume record" : "Volume en hausse", value: fmtPct(mom), text: txt + (isPeak ? " C'est le plus haut niveau de la période." : ""), names: [] });
      else V.push({ score: 10, title: "Volume en baisse", value: fmtPct(mom), text: txt, names: [] });
    } else if (mom != null) {
      H.push({ score: 0.004, title: "Volume stable", value: fmtPct(mom), text: `${fmtVol(cur)} ${unit} en ${M}, au même niveau qu'en ${P}.`, names: [] });
    }
    if (vsStart != null && vsStart <= -0.1 && !(mom != null && mom <= -0.01)) {
      V.push({ score: 0.02 + Math.abs(vsStart) * 0.05, title: "En retrait sur la période", value: fmtPct(vsStart), text: `Le volume ${de(M)} reste sous celui ${de(F)} (${fmtVol(cur)} contre ${fmtVol(first)}).`, names: [] });
    }
    if (vsStart != null && vsStart >= 0.1 && !isPeak) {
      H.push({ score: 0.01 + vsStart * 0.03, title: "Croissance sur la période", value: fmtPct(vsStart), text: `Le volume ${de(M)} dépasse celui ${de(F)} (${fmtVol(cur)} contre ${fmtVol(first)}).`, names: [] });
    }

    rows.filter((r) => r.delta > 0 && r.prev >= sig).sort((a, z) => z.delta - a.delta).slice(0, 3).forEach((r, k) => {
      H.push({ score: (r.delta / base) * (k ? 0.8 : 1), title: k ? "Forte progression" : "Meilleure progression", value: fmtDelta(r.delta), text: `${b(r.name)}${tag(r)} passe de ${fmtVol(r.prev)} à ${fmtVol(r.cur)} (${fmtPct(r.pct)}).`, names: [r.name] });
    });

    const news = rows.filter((r) => r.prev < sig * 0.01 && r.cur >= sig).sort((a, z) => z.cur - a.cur);
    if (news.length) {
      const sum = news.reduce((s, r) => s + r.cur, 0);
      H.push({ score: sum / base + 0.005, title: news.length > 1 ? "Nouveaux comptes actifs" : "Nouveau compte actif", value: String(news.length), text: `${list(news.map((r) => r.name))} ${news.length > 1 ? "génèrent" : "génère"} ${fmtVol(sum)} ${unit} en ${M}, contre un volume quasi nul en ${P}.`, names: news.map((r) => r.name) });
    }

    const ups = ents.map((e) => ({ e, n: streak(e.values, i, 1) })).filter((x) => x.n >= 3 && v(x.e, i) >= sig)
      .map((x) => ({ ...x, gain: v(x.e, i) - v(x.e, i - x.n) })).sort((a, z) => z.gain - a.gain);
    if (ups.length) {
      const x = ups[0];
      H.push({ score: (x.gain / base) * 0.6, title: "Dynamique durable", value: `${x.n} mois`, text: `${b(x.e.name)}${tag(x.e)} progresse ${x.n} mois de suite, de ${fmtVol(v(x.e, i - x.n))} à ${fmtVol(v(x.e, i))}.`, names: [x.e.name] });
    }

    const groupStats = !group && report.groups.length >= 2
      ? report.groups.map((g) => {
          const ge = report.entities.filter((e) => e.group === g);
          const c = ge.reduce((s, e) => s + v(e, i), 0), p = ge.reduce((s, e) => s + v(e, i - 1), 0);
          return { g, c, p, d: c - p, r: pct(c, p) };
        }).filter((s) => s.p >= sig)
      : [];
    const bestG = groupStats.filter((s) => s.d > 0).sort((a, z) => z.r - a.r)[0];
    if (bestG) H.push({ score: (bestG.d / base) * 0.7, title: "Portefeuille moteur", value: fmtPct(bestG.r), text: `Le portefeuille ${b(bestG.g)} gagne ${fmtDelta(bestG.d)} et atteint ${fmtVol(bestG.c)} ${unit}.`, names: [] });
    const worstG = groupStats.filter((s) => s.d < 0).sort((a, z) => a.r - z.r)[0];
    if (worstG) V.push({ score: (-worstG.d / base) * 0.7, title: "Portefeuille en recul", value: fmtPct(worstG.r), text: `Le portefeuille ${b(worstG.g)} perd ${fmtVol(-worstG.d)} et descend à ${fmtVol(worstG.c)} ${unit}.`, names: [] });

    const stops = rows.filter((r) => r.prev >= sig && r.cur <= r.prev * 0.02).sort((a, z) => z.prev - a.prev);
    if (stops.length) {
      const lost = stops.reduce((s, r) => s + r.prev - r.cur, 0);
      V.push({ score: lost / base + 0.02, title: "Arrêt de trafic", value: String(stops.length), text: `${list(stops.map((r) => r.name))} ${stops.length > 1 ? "ne remontent" : "ne remonte"} quasiment plus de volume en ${M} (${fmtVol(lost)} perdus par rapport à ${P}). Vérifier le tag ou l'intégration.`, names: stops.map((r) => r.name) });
    }

    rows.filter((r) => r.delta < 0 && r.prev >= sig).sort((a, z) => a.delta - z.delta).slice(0, 3).forEach((r, k) => {
      V.push({ score: (-r.delta / base) * (k ? 0.8 : 1), title: k ? "Baisse marquée" : "Plus forte baisse", value: fmtDelta(r.delta), text: `${b(r.name)}${tag(r)} recule de ${fmtVol(r.prev)} à ${fmtVol(r.cur)} (${fmtPct(r.pct)}).`, names: [r.name] });
    });

    const downs = ents.map((e) => ({ e, n: streak(e.values, i, -1) })).filter((x) => x.n >= 3 && v(x.e, i - x.n) >= sig)
      .map((x) => ({ ...x, loss: v(x.e, i - x.n) - v(x.e, i) })).sort((a, z) => z.loss - a.loss);
    if (downs.length) {
      const x = downs[0];
      V.push({ score: (x.loss / base) * 0.6, title: "Baisse continue", value: `${x.n} mois`, text: `${b(x.e.name)}${tag(x.e)} recule ${x.n} mois de suite, de ${fmtVol(v(x.e, i - x.n))} à ${fmtVol(v(x.e, i))}.`, names: [x.e.name] });
    }

    const top3 = [...rows].sort((a, z) => z.cur - a.cur).slice(0, 3);
    const top3Share = top3.reduce((s, r) => s + r.share, 0);
    if (rows.length >= 6 && top3Share >= 0.5) {
      V.push({ score: 0.003 + (top3Share - 0.5) * 0.02, title: "Forte concentration", value: fmtPct(top3Share, false), text: `Les 3 premiers comptes (${list(top3.map((r) => r.name))}) pèsent ${fmtPct(top3Share, false)} du volume ${de(M)} : dépendance élevée.`, names: [] });
    }

    const dormant = ents.filter((e) => e.values.slice(0, i + 1).every((x) => (x ?? 0) < 1000));
    if (dormant.length >= 2) {
      V.push({ score: 0.001, title: "Intégrations inactives", value: String(dormant.length), text: `${dormant.length} comptes restent sous 1 000 ${unit} par mois sur toute la période, par exemple ${list(dormant.map((e) => e.name), 2)}. Tags à relancer ou à nettoyer.`, names: [] });
    }

    return {
      month: months[i], monthIndex: i, prevMonth: months[i - 1], group, metric,
      totals, cur, prv, first, mom, vsStart, active, count: ents.length, rows,
      highlights: pick(H, "Pas d'autre signal positif notable ce mois-ci."),
      watchpoints: pick(V, "Pas d'autre signal d'alerte notable ce mois-ci."),
    };
  }

  function pick(cands, fallback) {
    const used = new Set();
    const out = [];
    for (const c of [...cands].sort((a, z) => z.score - a.score)) {
      if (c.names.some((n) => used.has(n))) continue;
      c.names.forEach((n) => used.add(n));
      out.push(c);
      if (out.length === 3) break;
    }
    while (out.length < 3) out.push({ title: "RAS", value: "—", text: fallback, names: [] });
    return out;
  }

  const api = { parseReport, analyse, monthKey, monthLabel, fmtVol, fmtPct, fmtDelta, esc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SuiviPerf = api;
})(typeof window !== "undefined" ? window : globalThis);
