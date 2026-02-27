import { useState, useCallback } from "react";

// ─── Color palette & global styles ───────────────────────────────────────────
const G = {
  bg: "#0d1117",
  surface: "#161b22",
  border: "#21262d",
  accent: "#f0a500",
  accentDim: "#f0a50033",
  accentHover: "#f7c04a",
  text: "#e6edf3",
  muted: "#8b949e",
  success: "#3fb950",
  danger: "#f85149",
  info: "#58a6ff",
  card: "#1c2128",
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Syne:wght@400;600;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:${G.bg};color:${G.text};font-family:'Syne',sans-serif}
  ::-webkit-scrollbar{width:6px}
  ::-webkit-scrollbar-track{background:${G.bg}}
  ::-webkit-scrollbar-thumb{background:${G.border};border-radius:3px}
  input[type=number],input[type=text],select{
    background:${G.bg};border:1px solid ${G.border};color:${G.text};
    padding:8px 12px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:13px;
    width:100%;outline:none;transition:border .2s;
  }
  input[type=number]:focus,input[type=text]:focus,select:focus{border-color:${G.accent}}
  select option{background:${G.bg}}
  button{cursor:pointer;font-family:'Syne',sans-serif;font-weight:700}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .fadeIn{animation:fadeIn .3s ease forwards}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
`;

// ─── NBR 6118 Engineering Functions ──────────────────────────────────────────

function calcEci(fck, alphaE = 1.0) {
  if (fck >= 20 && fck <= 50) return alphaE * 5600 * Math.sqrt(fck);
  if (fck > 50 && fck <= 90) return 21500 * alphaE * Math.pow(fck / 10 + 1.25, 1 / 3);
  return null;
}

function calcAlphai(fck) {
  return Math.min(0.8 + 0.2 * (fck / 80), 1.0);
}

function calcEcs(fck, alphaE = 1.0) {
  const Eci = calcEci(fck, alphaE);
  const ai = calcAlphai(fck);
  return ai * Eci;
}

function calcFctm(fck) {
  if (fck >= 20 && fck <= 50) return 0.3 * Math.pow(fck, 2 / 3);
  if (fck > 50 && fck <= 90) return 2.12 * Math.log(1 + 0.11 * fck);
  return null;
}

function calcEpsc2(fck) {
  if (fck >= 20 && fck <= 50) return 2.0;
  return (2 + 0.085 * Math.pow(fck - 50, 0.53));
}

function calcEpscu(fck) {
  if (fck >= 20 && fck <= 50) return 3.5;
  return 2.6 + 35 * Math.pow((90 - fck) / 100, 4);
}

function calcN(fck) {
  if (fck >= 20 && fck <= 50) return 2;
  return 1.4 + 23.4 * Math.pow((90 - fck) / 100, 4);
}

// Armadura longitudinal - flexão simples
function calcFlexaoSimples({ b, d, Md, fck, fyk, gamac = 1.4, gamas = 1.15 }) {
  const fcd = (fck / gamac);  // MPa
  const fyd = (fyk / gamas);  // MPa
  const Md_Nmm = Md * 1e6; // kN.m → N.mm

  const kMd = Md_Nmm / (b * d * d * fcd);

  // Domínio 2/3 - verificar se domínio 2 ou 3
  // x/d via equação quadrática simplificada (diagrama retangular)
  const lambda = fck <= 50 ? 0.8 : 0.8 - (fck - 50) / 250;
  const alphacc = 0.85; // coef redução resistência

  // kMd = lambda*(1-lambda*xi/2)*xi  onde xi = x/d
  // Resolvendo: lambda²/2 * xi² - lambda*xi + kMd/(alphacc) = 0
  const A = lambda * lambda / 2;
  const B = -lambda;
  const C = kMd / alphacc;
  const delta = B * B - 4 * A * C;

  if (delta < 0) return { error: "Seção insuficiente para o momento aplicado." };

  const xi = (-B - Math.sqrt(delta)) / (2 * A);
  const x = xi * d;

  // Domínio máximo (domínio 3/4 limite)
  const epsc2 = calcEpsc2(fck) / 1000;
  const epscu = calcEpscu(fck) / 1000;
  const epsy = fyd / 205000; // aço CA-50 aprox

  const xLim = epscu / (epscu + (10 * epsy)) * d; // domínio 3

  const dominio = x <= 0.259 * d ? 2 : x <= xLim ? 3 : 4;

  // Força de compressão
  const Fc = alphacc * fcd * lambda * x * b;
  const As = Fc / fyd;

  const rho = (As / (b * d)) * 100;

  return {
    kMd: kMd.toFixed(4),
    xi: xi.toFixed(4),
    x: x.toFixed(2),
    xLim: xLim.toFixed(2),
    dominio,
    As: As.toFixed(2),
    rho: rho.toFixed(3),
    fcd: fcd.toFixed(2),
    fyd: fyd.toFixed(2),
    lambda: lambda.toFixed(3),
    Fc: (Fc / 1000).toFixed(2),
  };
}

// Verificação de cisalhamento
function calcCisalhamento({ bw, d, Vsd, fck, fyk, thetaDeg = 45, gamac = 1.4, gamas = 1.15 }) {
  const fcd = fck / gamac;
  const fctm = calcFctm(fck);
  const fctd = fctm / gamac;
  const fyd = fyk / gamas;
  const Vsd_N = Vsd * 1000; // kN → N

  const theta = (thetaDeg * Math.PI) / 180;
  const cotTheta = Math.cos(theta) / Math.sin(theta);

  // Resistência ao esforço cortante (modelo I - bielas 45°)
  const Vrd2 = 0.27 * Math.pow(1 - fck / 250, 1) * fcd * bw * d;
  const Vrd2_kN = Vrd2 / 1000;

  // Verificar se precisa de armadura transversal
  const Vc = 0.6 * fctd * bw * d;
  const Vc_kN = Vc / 1000;

  const needsShearRebar = Vsd_N > Vc;

  // Armadura de cisalhamento (estribos verticais, theta=45°)
  // Asw/s = Vsd / (fyd * d * cotTheta)
  const Asw_s = Vsd_N / (fyd * d * (cotTheta + cotTheta)); // simplificado modelo I
  const Asw_s_cm2m = Asw_s * 10; // mm²/mm → cm²/m

  // Espaçamento máx
  const smax = Math.min(0.6 * d, 300);

  return {
    fcd: fcd.toFixed(2),
    fctm: fctm.toFixed(3),
    fctd: fctd.toFixed(3),
    fyd: fyd.toFixed(2),
    Vrd2: Vrd2_kN.toFixed(2),
    Vc: Vc_kN.toFixed(2),
    needsShearRebar,
    Asw_s: Asw_s_cm2m.toFixed(3),
    smax: smax.toFixed(0),
  };
}

// Cobrimento nominal
function getCnom(tipo, elemento, caa, deltaC = 10) {
  const table = {
    "Concreto Armado": {
      Laje: { I: 20, II: 25, III: 35, IV: 45 },
      "Viga/Pilar": { I: 25, II: 30, III: 40, IV: 50 },
      "Solo": { I: 30, II: 40, III: 50, IV: "-" },
    },
    "Concreto Protendido": {
      Laje: { I: 25, II: 30, III: 40, IV: 50 },
      "Viga/Pilar": { I: 30, II: 35, III: 45, IV: 55 },
    },
  };
  const cmin = table[tipo]?.[elemento]?.[caa];
  if (!cmin || cmin === "-") return null;
  return { cmin, cnom: Number(cmin) + deltaC };
}

// ─── UI Components ────────────────────────────────────────────────────────────

function Badge({ children, color = G.accent }) {
  return (
    <span style={{
      background: color + "22",
      color,
      border: `1px solid ${color}44`,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 11,
      fontFamily: "'JetBrains Mono',monospace",
      fontWeight: 600,
    }}>{children}</span>
  );
}

function Field({ label, unit, value, onChange, min, max, step = "any", hint }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, color: G.muted, fontWeight: 600, letterSpacing: "0.05em" }}>
        {label} {unit && <span style={{ color: G.accent, fontFamily: "'JetBrains Mono',monospace" }}>[{unit}]</span>}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(e.target.value)}
      />
      {hint && <span style={{ fontSize: 11, color: G.muted }}>{hint}</span>}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, color: G.muted, fontWeight: 600, letterSpacing: "0.05em" }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

function ResultRow({ label, value, unit, highlight, warn }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 12px",
      background: highlight ? G.accentDim : "transparent",
      borderRadius: 6,
      borderLeft: highlight ? `3px solid ${G.accent}` : `3px solid transparent`,
    }}>
      <span style={{ fontSize: 13, color: warn ? G.danger : G.muted }}>{label}</span>
      <span style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 14,
        fontWeight: 700,
        color: warn ? G.danger : highlight ? G.accent : G.text,
      }}>
        {value} {unit && <span style={{ fontSize: 11, color: G.muted }}>{unit}</span>}
      </span>
    </div>
  );
}

function Card({ title, badge, children, style = {} }) {
  return (
    <div style={{
      background: G.card,
      border: `1px solid ${G.border}`,
      borderRadius: 12,
      overflow: "hidden",
      ...style,
    }}>
      {title && (
        <div style={{
          padding: "14px 20px",
          borderBottom: `1px solid ${G.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: G.surface,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: G.text }}>{title}</span>
          {badge}
        </div>
      )}
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

function CalcButton({ onClick, loading, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: G.accent,
        color: "#000",
        border: "none",
        borderRadius: 8,
        padding: "12px 28px",
        fontSize: 14,
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        transition: "all .2s",
        animation: loading ? "pulse 1s infinite" : "none",
      }}
    >{children}</button>
  );
}

// ─── Tab: Materiais ───────────────────────────────────────────────────────────

function TabMateriais() {
  const [fck, setFck] = useState(25);
  const [alphaE, setAlphaE] = useState("1.0");
  const [result, setResult] = useState(null);

  const alphaOptions = [
    { v: "1.2", l: "1,2 – Basalto e Diabásio" },
    { v: "1.0", l: "1,0 – Granito e Gnaisse" },
    { v: "0.9", l: "0,9 – Calcário" },
    { v: "0.7", l: "0,7 – Arenito" },
  ];

  function calc() {
    const f = Number(fck);
    const a = Number(alphaE);
    const Eci = calcEci(f, a);
    const ai = calcAlphai(f);
    const Ecs = ai * Eci;
    const fctm = calcFctm(f);
    const n = calcN(f);
    const ec2 = calcEpsc2(f);
    const ecu = calcEpscu(f);

    setResult({ Eci, ai, Ecs, fctm, n, ec2, ecu, fck: f });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Parâmetros do Concreto" badge={<Badge>NBR 6118 §1.2</Badge>}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="fck – Resistência Característica" unit="MPa" value={fck} onChange={v => setFck(v)} min={20} max={90} hint="20 ≤ fck ≤ 90 MPa" />
          <SelectField label="αE – Agregado Graúdo" value={alphaE} onChange={setAlphaE} options={alphaOptions} />
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
          <CalcButton onClick={calc}>Calcular</CalcButton>
        </div>
      </Card>

      {result && (
        <div className="fadeIn" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card title="Módulos de Elasticidade">
            <ResultRow label="Eci – Módulo Tangente Inicial" value={(result.Eci / 1000).toFixed(2)} unit="GPa" highlight />
            <ResultRow label="αᵢ – Coeficiente" value={result.ai.toFixed(3)} />
            <ResultRow label="Ecs – Módulo Secante" value={(result.Ecs / 1000).toFixed(2)} unit="GPa" highlight />
            <ResultRow label="ν – Poisson" value="0,20" />
            <ResultRow label="Gc = 0,4·Ecs" value={(result.Ecs * 0.4 / 1000).toFixed(2)} unit="GPa" />
          </Card>
          <Card title="Resistência e Deformações">
            <ResultRow label="fctm – Tração Média" value={result.fctm.toFixed(3)} unit="MPa" highlight />
            <ResultRow label="fctk,inf = 0,7·fctm" value={(0.7 * result.fctm).toFixed(3)} unit="MPa" />
            <ResultRow label="fctk,sup = 1,3·fctm" value={(1.3 * result.fctm).toFixed(3)} unit="MPa" />
            <ResultRow label="n – Expoente diagrama" value={result.n.toFixed(3)} />
            <ResultRow label="εc2 – Deformação patamar" value={result.ec2.toFixed(3)} unit="‰" highlight />
            <ResultRow label="εcu – Deformação ruptura" value={result.ecu.toFixed(3)} unit="‰" highlight />
          </Card>
        </div>
      )}

      <Card title="Propriedades do Aço" badge={<Badge color={G.info}>NBR 6118 §1.3</Badge>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {[
            ["ρs", "7.850 kg/m³", "Massa específica"],
            ["Es", "210.000 MPa", "Módulo de elasticidade"],
            ["ν", "0,30", "Poisson"],
            ["αTs", "10⁻⁵ /°C", "Dil. térmica"],
            ["CA-50", "fyk = 500 MPa", "Escoamento"],
            ["CA-60", "fyk = 600 MPa", "Escoamento"],
          ].map(([a, b, c]) => (
            <div key={a} style={{ background: G.bg, borderRadius: 8, padding: "12px 14px", border: `1px solid ${G.border}` }}>
              <div style={{ fontSize: 11, color: G.muted, marginBottom: 4 }}>{c}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: G.info, fontWeight: 700 }}>{a}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 700, color: G.text, marginTop: 2 }}>{b}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Tabela de Bitolas Comerciais" badge={<Badge color={G.success}>NBR 6118 Tabela 1-2</Badge>}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>
            <thead>
              <tr style={{ background: G.surface }}>
                {["Barras (mm)", "Área (cm²)", "Massa (kg/m)", "Perímetro (cm)"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", color: G.accent, textAlign: "left", fontWeight: 700, borderBottom: `1px solid ${G.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                [5.0, 0.200, 0.160, 1.60],
                [6.3, 0.315, 0.250, 2.00],
                [8.0, 0.500, 0.400, 2.50],
                [10.0, 0.800, 0.630, 3.15],
                [12.5, 1.250, 1.000, 4.00],
                [16.0, 2.000, 1.600, 5.00],
                [20.0, 3.150, 2.500, 6.30],
                [25.0, 5.000, 4.000, 8.00],
                [32.0, 8.000, 6.300, 10.00],
              ].map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : G.surface + "44" }}>
                  {row.map((c, j) => (
                    <td key={j} style={{ padding: "8px 12px", color: j === 0 ? G.accent : G.text, borderBottom: `1px solid ${G.border}22` }}>
                      {j === 0 ? `Ø ${c}` : c.toFixed(3).replace(".", ",")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Tab: Flexão Simples ──────────────────────────────────────────────────────

function TabFlexao() {
  const [b, setB] = useState(200);
  const [d, setD] = useState(450);
  const [Md, setMd] = useState(80);
  const [fck, setFck] = useState(25);
  const [fyk, setFyk] = useState(500);
  const [gamac, setGamac] = useState(1.4);
  const [gamas, setGamas] = useState(1.15);
  const [result, setResult] = useState(null);

  function calc() {
    const r = calcFlexaoSimples({
      b: Number(b), d: Number(d), Md: Number(Md),
      fck: Number(fck), fyk: Number(fyk),
      gamac: Number(gamac), gamas: Number(gamas),
    });
    setResult(r);
  }

  const dominioColor = result?.dominio === 2 ? G.success : result?.dominio === 3 ? G.accent : G.danger;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Dados da Seção – Flexão Simples" badge={<Badge>NBR 6118 §17.3</Badge>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 16 }}>
          <Field label="b – Largura da seção" unit="mm" value={b} onChange={setB} min={100} />
          <Field label="d – Altura útil" unit="mm" value={d} onChange={setD} min={50} />
          <Field label="Md – Momento de cálculo" unit="kN·m" value={Md} onChange={setMd} min={0} />
          <Field label="fck" unit="MPa" value={fck} onChange={setFck} min={20} max={90} />
          <Field label="fyk" unit="MPa" value={fyk} onChange={setFyk} min={250} max={600} />
          <Field label="γc" unit="–" value={gamac} onChange={setGamac} step={0.05} />
        </div>
        <CalcButton onClick={calc}>Calcular Armadura</CalcButton>
      </Card>

      {result && !result.error && (
        <div className="fadeIn" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card title="Verificações">
            <ResultRow label="fcd = fck / γc" value={result.fcd} unit="MPa" />
            <ResultRow label="fyd = fyk / γs" value={result.fyd} unit="MPa" />
            <ResultRow label="λ – Fator bloco retangular" value={result.lambda} />
            <ResultRow label="kMd = Md / (b·d²·fcd)" value={result.kMd} highlight />
            <ResultRow label="ξ = x / d" value={result.xi} highlight />
            <ResultRow label="x – Linha neutra" value={result.x} unit="mm" highlight />
            <ResultRow label="x,lim (dom. 3)" value={result.xLim} unit="mm" />
          </Card>
          <Card title="Resultados" badge={<Badge color={dominioColor}>Domínio {result.dominio}</Badge>}>
            <div style={{ background: G.bg, borderRadius: 8, padding: 14, marginBottom: 12, border: `1px solid ${dominioColor}33` }}>
              <div style={{ fontSize: 12, color: G.muted, marginBottom: 4 }}>Domínio de deformação</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 800, color: dominioColor }}>
                {result.dominio === 2 ? "2 – Subarmada ✓" : result.dominio === 3 ? "3 – Transição ✓" : "4 – Superarmada ✗"}
              </div>
              {result.dominio === 4 && (
                <div style={{ fontSize: 12, color: G.danger, marginTop: 6 }}>⚠ Seção superarmada – aumentar dimensões!</div>
              )}
            </div>
            <ResultRow label="Fc – Força de compressão" value={result.Fc} unit="kN" />
            <ResultRow label="As – Área de armadura" value={result.As} unit="mm²" highlight />
            <ResultRow label="As" value={(Number(result.As) / 100).toFixed(3)} unit="cm²" highlight />
            <ResultRow label="ρ = As / (b·d)" value={result.rho} unit="%" />
            <ResultRow
              label="ρ,mín (CA-50, fck≤50)"
              value="0.150"
              unit="%"
              warn={Number(result.rho) < 0.15}
            />
          </Card>
        </div>
      )}

      {result?.error && (
        <div className="fadeIn" style={{ background: G.danger + "22", border: `1px solid ${G.danger}44`, borderRadius: 10, padding: 16, color: G.danger }}>
          ⚠ {result.error}
        </div>
      )}

      <Card title="Sugestão de Bitolas" badge={<Badge color={G.info}>Tabela 1-2</Badge>}>
        {result && !result.error ? (
          <div>
            <div style={{ fontSize: 12, color: G.muted, marginBottom: 12 }}>
              As necessária: <strong style={{ color: G.accent }}>{result.As} mm² = {(Number(result.As) / 100).toFixed(3)} cm²</strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
              {[
                { d: 8.0, a: 50.0 },
                { d: 10.0, a: 80.0 },
                { d: 12.5, a: 125.0 },
                { d: 16.0, a: 200.0 },
                { d: 20.0, a: 314.0 },
                { d: 25.0, a: 490.7 },
              ].map(bar => {
                const n = Math.ceil(Number(result.As) / (bar.a * 100));
                const total = n * bar.a * 100;
                const ok = total >= Number(result.As);
                return (
                  <div key={bar.d} style={{
                    background: ok ? G.success + "18" : G.bg,
                    border: `1px solid ${ok ? G.success + "44" : G.border}`,
                    borderRadius: 8, padding: "10px 12px", fontSize: 12,
                  }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: ok ? G.success : G.muted, marginBottom: 4 }}>
                      Ø{bar.d}mm
                    </div>
                    <div style={{ color: G.text, fontWeight: 700 }}>{n}Ø{bar.d}</div>
                    <div style={{ color: G.muted, marginTop: 2 }}>{(total / 100).toFixed(3)} cm²</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ color: G.muted, fontSize: 13 }}>Calcule a seção para ver sugestões de bitolas.</div>
        )}
      </Card>
    </div>
  );
}

// ─── Tab: Cisalhamento ────────────────────────────────────────────────────────

function TabCisalhamento() {
  const [bw, setBw] = useState(200);
  const [d, setD] = useState(450);
  const [Vsd, setVsd] = useState(60);
  const [fck, setFck] = useState(25);
  const [fyk, setFyk] = useState(500);
  const [theta, setTheta] = useState(45);
  const [result, setResult] = useState(null);

  function calc() {
    const r = calcCisalhamento({
      bw: Number(bw), d: Number(d), Vsd: Number(Vsd),
      fck: Number(fck), fyk: Number(fyk), thetaDeg: Number(theta),
    });
    setResult(r);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Verificação ao Cisalhamento" badge={<Badge>NBR 6118 §17.4</Badge>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginBottom: 16 }}>
          <Field label="bw – Largura da alma" unit="mm" value={bw} onChange={setBw} min={100} />
          <Field label="d – Altura útil" unit="mm" value={d} onChange={setD} min={50} />
          <Field label="Vsd – Cortante de cálculo" unit="kN" value={Vsd} onChange={setVsd} min={0} />
          <Field label="fck" unit="MPa" value={fck} onChange={setFck} min={20} max={90} />
          <Field label="fywk (estribos)" unit="MPa" value={fyk} onChange={setFyk} min={250} max={600} />
          <Field label="θ – Ângulo bielas (45° a 68,2°)" unit="°" value={theta} onChange={setTheta} min={30} max={68} />
        </div>
        <CalcButton onClick={calc}>Verificar Cisalhamento</CalcButton>
      </Card>

      {result && (
        <div className="fadeIn" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card title="Resistências">
            <ResultRow label="fcd" value={result.fcd} unit="MPa" />
            <ResultRow label="fctm" value={result.fctm} unit="MPa" />
            <ResultRow label="fctd = fctm / γc" value={result.fctd} unit="MPa" />
            <ResultRow label="Vrd2 – Resistência das bielas" value={result.Vrd2} unit="kN" highlight warn={Number(Vsd) > Number(result.Vrd2)} />
            {Number(Vsd) > Number(result.Vrd2) && (
              <div style={{ padding: "8px 12px", background: G.danger + "22", borderRadius: 6, fontSize: 12, color: G.danger }}>
                ⚠ Vsd &gt; Vrd2 – Seção insuficiente! Aumentar dimensões.
              </div>
            )}
          </Card>
          <Card title="Armadura Transversal">
            <ResultRow label="Vc – Parcela de concreto" value={result.Vc} unit="kN" />
            <ResultRow
              label="Necessita armadura transv."
              value={result.needsShearRebar ? "SIM" : "NÃO"}
              warn={result.needsShearRebar}
            />
            {result.needsShearRebar && (
              <>
                <ResultRow label="Asw/s" value={result.Asw_s} unit="cm²/m" highlight />
                <ResultRow label="Espaçamento máx." value={result.smax} unit="mm" />
                <div style={{ margin: "8px 12px 0", fontSize: 12, color: G.muted }}>
                  Sugestão: Para estribos Ø8mm (2 ramos → 2×0.5=1.0cm²):
                  <span style={{ color: G.accent, fontFamily: "'JetBrains Mono',monospace", marginLeft: 6 }}>
                    s = {Math.min(Math.floor(100 / Number(result.Asw_s)) * 10, Number(result.smax))} mm
                  </span>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Cobrimento ──────────────────────────────────────────────────────────

function TabCobrimento() {
  const [tipo, setTipo] = useState("Concreto Armado");
  const [elemento, setElemento] = useState("Viga/Pilar");
  const [caa, setCaa] = useState("II");
  const [deltaC, setDeltaC] = useState(10);
  const [phi, setPhi] = useState(12.5);
  const [dmax, setDmax] = useState(19);
  const [result, setResult] = useState(null);

  function calc() {
    const r = getCnom(tipo, elemento, caa, Number(deltaC));
    if (!r) { setResult({ error: "Combinação não disponível na norma." }); return; }
    const cnomPhi = Math.max(r.cnom, Number(phi));
    const cnomDmax = Math.max(r.cnom, 1.2 * Number(dmax));
    const cnomFinal = Math.max(cnomPhi, r.cnom);
    setResult({ ...r, cnomPhi, cnomDmax, cnomFinal });
  }

  const tipoOpts = [
    { v: "Concreto Armado", l: "Concreto Armado" },
    { v: "Concreto Protendido", l: "Concreto Protendido" },
  ];
  const elemCA = [
    { v: "Laje", l: "Laje" },
    { v: "Viga/Pilar", l: "Viga / Pilar" },
    { v: "Solo", l: "Em contato com solo" },
  ];
  const elemCP = [
    { v: "Laje", l: "Laje" },
    { v: "Viga/Pilar", l: "Viga / Pilar" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Classe de Agressividade Ambiental" badge={<Badge>NBR 6118 §6.4</Badge>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { v: "I", l: "CAA-I", sub: "Fraca – Rural / Submersa", risk: "Insignificante" },
            { v: "II", l: "CAA-II", sub: "Moderada – Urbana", risk: "Pequeno" },
            { v: "III", l: "CAA-III", sub: "Forte – Marinha / Industrial", risk: "Grande" },
            { v: "IV", l: "CAA-IV", sub: "Muito forte – Resp. maré", risk: "Elevado" },
          ].map(c => (
            <div
              key={c.v}
              onClick={() => setCaa(c.v)}
              style={{
                background: caa === c.v ? G.accentDim : G.bg,
                border: `2px solid ${caa === c.v ? G.accent : G.border}`,
                borderRadius: 10, padding: "12px 14px", cursor: "pointer", transition: "all .2s",
              }}
            >
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, color: caa === c.v ? G.accent : G.muted, marginBottom: 4 }}>{c.l}</div>
              <div style={{ fontSize: 11, color: G.text, marginBottom: 4 }}>{c.sub}</div>
              <div style={{ fontSize: 10, color: G.muted }}>Risco: {c.risk}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          <SelectField label="Tipo" value={tipo} onChange={v => { setTipo(v); setElemento("Viga/Pilar"); }} options={tipoOpts} />
          <SelectField label="Elemento" value={elemento} onChange={setElemento} options={tipo === "Concreto Armado" ? elemCA : elemCP} />
          <Field label="Δc – Tolerância de execução" unit="mm" value={deltaC} onChange={setDeltaC} min={5} hint="Obra corrente: 10mm; Rigoroso: 5mm" />
          <Field label="φ – Diâm. maior barra" unit="mm" value={phi} onChange={setPhi} min={5} />
        </div>
        <div style={{ marginTop: 16 }}>
          <CalcButton onClick={calc}>Calcular Cobrimento</CalcButton>
        </div>
      </Card>

      {result && !result.error && (
        <div className="fadeIn" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card title="Cobrimentos">
            <ResultRow label="Cmin – Cobrimento mínimo (Tabela 2-3)" value={result.cmin} unit="mm" />
            <ResultRow label="Δc – Tolerância de execução" value={deltaC} unit="mm" />
            <ResultRow label="Cnom = Cmin + Δc" value={result.cnom} unit="mm" highlight />
            <ResultRow label="Cnom ≥ φ" value={result.cnomPhi} unit="mm" />
            <ResultRow label="Cnom ≥ 1,2·Dmax" value={Number(result.cnomDmax).toFixed(0)} unit="mm" warn={Number(result.cnomDmax) > result.cnom} />
          </Card>
          <Card title="Cobrimento Nominal Adotado">
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "100%", gap: 8,
            }}>
              <div style={{ fontSize: 13, color: G.muted }}>Adotar cobrimento nominal</div>
              <div style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 52, fontWeight: 800, color: G.accent,
                lineHeight: 1.1,
              }}>
                {result.cnomFinal}
              </div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, color: G.muted }}>mm</div>
              <div style={{ marginTop: 8, fontSize: 12, color: G.muted, textAlign: "center" }}>
                c<sub>nom</sub> ≥ φ<sub>barra</sub> → verifique sempre
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card title="Correspondência CAA × Qualidade do Concreto" badge={<Badge color={G.success}>Tabela 2-2</Badge>}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "'JetBrains Mono',monospace" }}>
            <thead>
              <tr style={{ background: G.surface }}>
                <th style={{ padding: "10px 14px", textAlign: "left", color: G.accent, borderBottom: `1px solid ${G.border}` }}>Parâmetro</th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: G.accent, borderBottom: `1px solid ${G.border}` }}>CAA-I</th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: G.accent, borderBottom: `1px solid ${G.border}` }}>CAA-II</th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: G.accent, borderBottom: `1px solid ${G.border}` }}>CAA-III</th>
                <th style={{ padding: "10px 14px", textAlign: "center", color: G.accent, borderBottom: `1px solid ${G.border}` }}>CAA-IV</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["a/c CA", "≤ 0,65", "≤ 0,60", "≤ 0,55", "≤ 0,45"],
                ["a/c CP", "≤ 0,60", "≤ 0,55", "≤ 0,50", "≤ 0,45"],
                ["Classe CA", "≥ C20", "≥ C25", "≥ C30", "≥ C40"],
                ["Classe CP", "≥ C25", "≥ C30", "≥ C35", "≥ C40"],
              ].map((row, i) => (
                <tr key={i} style={{ background: i % 2 ? G.surface + "44" : "transparent" }}>
                  {row.map((c, j) => (
                    <td key={j} style={{
                      padding: "8px 14px",
                      textAlign: j === 0 ? "left" : "center",
                      color: j === 0 ? G.muted : G.text,
                      borderBottom: `1px solid ${G.border}22`,
                    }}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "materiais", label: "Materiais", icon: "⬡" },
  { id: "flexao", label: "Flexão Simples", icon: "⌒" },
  { id: "cisalhamento", label: "Cisalhamento", icon: "⟋" },
  { id: "cobrimento", label: "Cobrimento", icon: "◫" },
];

export default function App() {
  const [tab, setTab] = useState("materiais");

  return (
    <>
      <style>{css}</style>
      <div style={{ minHeight: "100vh", background: G.bg }}>
        {/* Header */}
        <div style={{
          background: G.surface,
          borderBottom: `1px solid ${G.border}`,
          padding: "0 32px",
          position: "sticky", top: 0, zIndex: 100,
        }}>
          <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", height: 60, gap: 24 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: G.accent, letterSpacing: "0.06em" }}>
                NBR 6118
              </span>
              <span style={{ fontSize: 10, color: G.muted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Concreto Armado · Calculadora
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 4 }}>
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    background: tab === t.id ? G.accentDim : "transparent",
                    color: tab === t.id ? G.accent : G.muted,
                    border: `1px solid ${tab === t.id ? G.accent + "44" : "transparent"}`,
                    borderRadius: 8,
                    padding: "7px 16px",
                    fontSize: 13,
                    fontWeight: tab === t.id ? 700 : 500,
                    transition: "all .2s",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 15 }}>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 32px 60px" }}>
          {tab === "materiais" && <TabMateriais />}
          {tab === "flexao" && <TabFlexao />}
          {tab === "cisalhamento" && <TabCisalhamento />}
          {tab === "cobrimento" && <TabCobrimento />}
        </div>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${G.border}`,
          padding: "14px 32px",
          background: G.surface,
          textAlign: "center",
          fontSize: 11,
          color: G.muted,
          fontFamily: "'JetBrains Mono',monospace",
        }}>
          NBR 6118:2023 — Projeto de estruturas de concreto — Procedimento · Uso exclusivo para pré-dimensionamento; confirme com engenheiro habilitado.
        </div>
      </div>
    </>
  );
}
