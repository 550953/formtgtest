// render-core.js
// Общий движок: тянет schema.json, рендерит через переданный "адаптер" темы,
// собирает ответы и шлёт на воркер. Конкретная разметка/классы — в адаптере каждой страницы.

const WORKER_URL = "https://form-submit.550953.workers.dev/";

async function loadSchema() {
  const res = await fetch("./schema.json");
  return res.json();
}

function buildField(field, adapter) {
  switch (field.type) {
    case "radio":
      return adapter.radio(field);
    case "checkbox":
      return adapter.checkbox(field);
    case "textarea":
      return adapter.textarea(field);
    case "number":
      return adapter.number(field);
    case "file":
      return adapter.file(field);
    case "text":
    default:
      return adapter.text(field);
  }
}

async function renderForm(rootId, adapter) {
  const schema = await loadSchema();
  const root = document.getElementById(rootId);
  root.innerHTML = adapter.header(schema);

  const formEl = document.createElement("form");
  formEl.id = "genForm";

  schema.sections.forEach((section) => {
    const sectionWrap = document.createElement("div");
    sectionWrap.innerHTML = adapter.sectionStart(section);
    const body = sectionWrap.querySelector("[data-fields]") || sectionWrap;
    section.fields.forEach((field) => {
      body.insertAdjacentHTML("beforeend", buildField(field, adapter));
    });
    formEl.appendChild(sectionWrap);
  });

  formEl.insertAdjacentHTML("beforeend", adapter.submitButton());
  root.appendChild(formEl);

  formEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const answers = {};
    schema.sections.forEach((s) =>
      s.fields.forEach((f) => {
        if (f.type === "checkbox") {
          answers[f.id] = Array.from(
            formEl.querySelectorAll(`input[name="${f.id}"]:checked`)
          ).map((el) => el.value);
        } else if (f.type === "file") {
          // TODO: аплоуд файла — пока не отправляем, только фиксируем что поле было
          const input = formEl.querySelector(`input[name="${f.id}"]`);
          answers[f.id] = input && input.files.length ? `[файл: ${input.files[0].name}] (TODO: не загружен)` : "(не прикреплён)";
        } else {
          const el = formEl.querySelector(`[name="${f.id}"]`);
          answers[f.id] = el ? el.value : "";
        }
      })
    );

    const statusEl = document.getElementById("status");
    try {
      const resp = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ form: schema.form_id + "-" + adapter.themeName, answers }),
      });
      if (statusEl) statusEl.textContent = resp.ok ? "Отправлено! 🙌" : "Ошибка отправки";
    } catch (err) {
      if (statusEl) statusEl.textContent = "Ошибка сети: " + err.message;
    }
  });
}
