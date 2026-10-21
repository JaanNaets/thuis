import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import type { Taxonomy, Vendor, VendorDetail, VendorInput } from "../../shared/types";
import { formatCompanyNumber, formatIban, isValidCompanyNumber, isValidIban, VENDOR_KINDS, type VendorKind } from "../../shared/vendor";
import { api, apiUrl, useApi } from "../api";
import { SubmitButton, TreeSelect } from "../components/Controls";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/Page";
import { useToast } from "../components/Toast";
import { prepareLogo } from "../image";
import { useNavigate } from "../router";
import { categoryTree, refreshTaxonomy, useTaxonomy } from "../taxonomy";

export function VendorFormPage() {
  const { id } = useParams();
  const { data: taxonomy, error } = useTaxonomy();
  if (error && !taxonomy) return <p className="error page">{error}</p>;
  if (!taxonomy) return null;
  if (!id) return <VendorForm taxonomy={taxonomy} />;
  return <EditVendor id={id} taxonomy={taxonomy} />;
}

function EditVendor({ id, taxonomy }: { id: string; taxonomy: Taxonomy }) {
  const { data, error } = useApi<VendorDetail>(`/vendors/${id}`);
  if (error) return <p className="error page">{error}</p>;
  if (!data) return null;
  return <VendorForm existing={data} taxonomy={taxonomy} />;
}

type Logo = { kind: "keep" } | { kind: "new"; file: File; preview: string } | { kind: "remove" };

function VendorForm({ existing, taxonomy }: { existing?: Vendor; taxonomy: Taxonomy }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<VendorInput>({
    name: existing?.name ?? "",
    kind: existing?.kind ?? null,
    category_id: existing?.category_id ?? null,
    website: existing?.website ?? "",
    phone: existing?.phone ?? "",
    email: existing?.email ?? "",
    notes: existing?.notes ?? "",
    customer_number: existing?.customer_number ?? "",
    account_member_id: existing?.account_member_id ?? null,
    account_login: existing?.account_login ?? "",
    company_number: existing?.company_number ? formatCompanyNumber(existing.company_number) : "",
    iban: existing?.iban ? formatIban(existing.iban) : "",
  });
  const [logo, setLogo] = useState<Logo>({ kind: "keep" });
  const [savedId, setSavedId] = useState(existing?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof VendorInput>(key: K, value: VendorInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const companyInvalid = Boolean(form.company_number?.trim()) && !isValidCompanyNumber(form.company_number ?? "");
  const ibanInvalid = Boolean(form.iban?.trim()) && !isValidIban(form.iban ?? "");
  // Wie een account kan hebben: de bewoners, plus wie er nu al staat.
  const owners = taxonomy.members.filter((m) => m.active === 1 || m.id === existing?.account_member_id);

  // Het voorbeeld van een nieuw logo opruimen als het niet meer nodig is.
  useEffect(() => {
    if (logo.kind !== "new") return;
    return () => URL.revokeObjectURL(logo.preview);
  }, [logo]);

  const logoSrc =
    logo.kind === "new"
      ? logo.preview
      : logo.kind === "keep" && existing?.logo_version
        ? apiUrl(`/vendors/${existing.id}/logo?v=${existing.logo_version}`)
        : null;

  async function chooseLogo(file: File | undefined) {
    if (!file) return;
    const prepared = await prepareLogo(file);
    setLogo({ kind: "new", file: prepared, preview: URL.createObjectURL(prepared) });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (companyInvalid) return setError("Dit ondernemingsnummer klopt niet. Kijk het na op een factuur.");
    if (ibanInvalid) return setError("Dit rekeningnummer (IBAN) klopt niet.");
    setBusy(true);
    setError(undefined);
    try {
      const saved = savedId ? await api.put<Vendor>(`/vendors/${savedId}`, form) : await api.post<Vendor>("/vendors", form);
      setSavedId(saved.id);
      if (logo.kind === "new") {
        const body = new FormData();
        body.append("file", logo.file);
        await api.put(`/vendors/${saved.id}/logo`, body);
      } else if (logo.kind === "remove" && existing?.logo_version) {
        await api.delete(`/vendors/${saved.id}/logo`);
      }
      await refreshTaxonomy();
      toast(existing ? "Verkoper bijgewerkt" : "Verkoper bewaard");
      navigate(`/verkopers/${saved.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="form page" onSubmit={onSubmit}>
      <PageHead title={existing ? "Verkoper bewerken" : "Nieuwe verkoper"} back={{ to: -1, label: existing ? existing.name : "Verkopers" }} />

      <section className="card form-section">
        <div className="logo-field">
          <button type="button" className="logo-pick" onClick={() => fileInput.current?.click()} aria-label={logoSrc ? "Ander logo kiezen" : "Logo kiezen"}>
            {logoSrc ? <img src={logoSrc} alt="" /> : <Icon name="image" size={20} />}
          </button>
          <div style={{ display: "grid", gap: 4 }}>
            <span className="label">Logo</span>
            <span className="hint">Een foto of afbeelding; vierkant werkt het best.</span>
            <div className="btn-row" style={{ justifySelf: "start" }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" size={15} /> {logoSrc ? "Ander logo" : "Kiezen"}
              </button>
              {logoSrc && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLogo({ kind: "remove" })}>
                  Weg
                </button>
              )}
            </div>
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => chooseLogo(e.target.files?.[0])} />
        </div>

        <label className="field">
          <span className="label">Naam</span>
          <input
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="bv. Colruyt, Coolblue, Loodgieter Peeters"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="label">Soort</span>
            <select value={form.kind ?? ""} onChange={(e) => set("kind", (e.target.value || null) as VendorKind | null)}>
              <option value="">Geen soort</option>
              {(Object.keys(VENDOR_KINDS) as VendorKind[]).map((k) => (
                <option key={k} value={k}>
                  {VENDOR_KINDS[k].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Categorie</span>
            <TreeSelect nodes={categoryTree(taxonomy, "expense")} value={form.category_id} onChange={(id) => set("category_id", id)} empty="Geen categorie" />
          </label>
        </div>
        <span className="hint" style={{ marginTop: -8 }}>
          Wat je er meestal koopt: een nieuwe aankoop hier krijgt die categorie alvast.
        </span>
      </section>

      <section className="card form-section">
        <label className="field">
          <span className="label">Website</span>
          <input inputMode="url" maxLength={200} value={form.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="bv. coolblue.be" />
        </label>
        <div className="field-row">
          <label className="field">
            <span className="label">Telefoon</span>
            <input type="tel" maxLength={40} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </label>
          <label className="field">
            <span className="label">E-mail</span>
            <input type="email" maxLength={200} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="klantendienst@…" />
          </label>
        </div>
      </section>

      <section className="card form-section">
        <div className="field">
          <span className="label">Je account</span>
          <span className="hint">Nooit een wachtwoord: dat hoort in je wachtwoordbeheerder.</span>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="label">Klantnummer</span>
            <input className="mono" maxLength={100} value={form.customer_number ?? ""} onChange={(e) => set("customer_number", e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Op naam van</span>
            <select value={form.account_member_id ?? ""} onChange={(e) => set("account_member_id", e.target.value || null)}>
              <option value="">Niemand in het bijzonder</option>
              {owners.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="label">
            Aanmelden met <span className="optional">· e-mailadres of gebruikersnaam</span>
          </span>
          <input maxLength={200} autoComplete="off" value={form.account_login ?? ""} onChange={(e) => set("account_login", e.target.value)} />
        </label>
      </section>

      <section className="card form-section">
        <div className="field-row field-row-wide">
          <label className="field">
            <span className="label">Ondernemingsnummer</span>
            <input
              className="mono"
              maxLength={30}
              value={form.company_number ?? ""}
              onChange={(e) => set("company_number", e.target.value)}
              onBlur={() => !companyInvalid && form.company_number && set("company_number", formatCompanyNumber(form.company_number))}
              aria-invalid={companyInvalid}
              placeholder="0123.456.749"
            />
          </label>
          <label className="field">
            <span className="label">IBAN</span>
            <input
              className="mono"
              maxLength={40}
              value={form.iban ?? ""}
              onChange={(e) => set("iban", e.target.value)}
              onBlur={() => !ibanInvalid && form.iban && set("iban", formatIban(form.iban))}
              aria-invalid={ibanInvalid}
              placeholder="BE68 5390 0754 7034"
            />
          </label>
        </div>
        {(companyInvalid || ibanInvalid) && (
          <span className="hint error">{companyInvalid ? "Dit ondernemingsnummer klopt niet." : "Dit rekeningnummer klopt niet."}</span>
        )}

        <label className="field">
          <span className="label">
            <Icon name="note" size={15} /> Notitie
          </span>
          <textarea
            rows={3}
            maxLength={2000}
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Leveringsvoorwaarden, korting, afspraken…"
          />
        </label>
      </section>

      {error && <p className="error">{error}</p>}

      <SubmitButton busy={busy} className="btn btn-primary btn-lg">
        {busy ? "Opslaan…" : "Opslaan"}
      </SubmitButton>
    </form>
  );
}
