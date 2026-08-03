const state = {
  products: [],
  movementType: "in",
  authenticated: false,
  productImageFile: null,
  productImagePreviewUrl: null,
  variantImageFiles: new Map(),
  variantImagePreviewUrls: new Map(),
  variantExistingImages: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const els = {
  loginView: $("#loginView"), appView: $("#appView"), loginForm: $("#loginForm"), password: $("#password"),
  logoutBtn: $("#logoutBtn"), changePasswordBtn: $("#changePasswordBtn"), newProductBtn: $("#newProductBtn"), alertBox: $("#alertBox"),
  metricProducts: $("#metricProducts"), metricStock: $("#metricStock"), metricIn: $("#metricIn"), metricOut: $("#metricOut"), metricLow: $("#metricLow"),
  productSearch: $("#productSearch"), productsTable: $("#productsTable"), productModal: $("#productModal"), productModalTitle: $("#productModalTitle"),
  productForm: $("#productForm"), productId: $("#productId"), sku: $("#sku"), initialStockLabel: $("#initialStockLabel"), initialStock: $("#initialStock"), passwordModal: $("#passwordModal"), passwordForm: $("#passwordForm"), currentPassword: $("#currentPassword"), newPassword: $("#newPassword"), confirmPassword: $("#confirmPassword"),
  productImage: $("#productImage"), imagePasteZone: $("#imagePasteZone"), imagePasteText: $("#imagePasteText"), imagePreview: $("#imagePreview"),
  name: $("#name"), unit: $("#unit"), mainSpecRows: $("#mainSpecRows"), subSpecRows: $("#subSpecRows"),
  addMainSpecValueBtn: $("#addMainSpecValueBtn"), addSubSpecValueBtn: $("#addSubSpecValueBtn"), enableSubSpecBtn: $("#enableSubSpecBtn"), disableSubSpecBtn: $("#disableSubSpecBtn"), subSpecSection: $("#subSpecSection"), addSubSpecPrompt: $("#addSubSpecPrompt"),
  variantStockRows: $("#variantStockRows"), lowStock: $("#lowStock"), productHappenedAt: $("#productHappenedAt"), productNote: $("#productNote"),
  cancelProductEdit: $("#cancelProductEdit"), productSaveBtn: $("#productSaveBtn"), movementModal: $("#movementModal"), movementModalTitle: $("#movementModalTitle"),
  typeIn: $("#typeIn"), typeOut: $("#typeOut"), movementForm: $("#movementForm"), movementProduct: $("#movementProduct"), movementVariant: $("#movementVariant"),
  quantity: $("#quantity"), happenedAt: $("#happenedAt"), unitPrice: $("#unitPrice"), reference: $("#reference"), movementNote: $("#movementNote"), movementSubmit: $("#movementSubmit"),
};

function showAlert(message) {
  els.alertBox.textContent = message || "";
  els.alertBox.classList.toggle("hidden", !message);
}

async function api(path, options = {}) {
  const { showLoginOnUnauthorized = true, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers || {}) };
  if (!(fetchOptions.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { headers, credentials: "same-origin", ...fetchOptions });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    if (response.status === 401 && showLoginOnUnauthorized) showLogin();
    throw new Error(body.error || "请求失败");
  }
  return body;
}

function showLogin() { closeAllModals(); els.loginView.classList.remove("hidden"); els.appView.classList.add("hidden"); els.password.focus(); }
function showApp() { els.loginView.classList.add("hidden"); els.appView.classList.remove("hidden"); }
function openModal(modal) { modal.classList.remove("hidden"); }
function closeModal(modal) { modal.classList.add("hidden"); }
function closeAllModals() { closeModal(els.productModal); closeModal(els.passwordModal); closeModal(els.movementModal); }
function formatNumber(value) { return Number(value || 0).toLocaleString("zh-CN"); }
function today() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function variantLabel(variant) {
  const parts = [variant.main_spec, variant.sub_spec].filter((value) => value && value !== "default");
  return parts.join(" / ") || "默认规格";
}
function collectManualSpecValues(container) {
  return [...container.querySelectorAll(".manual-spec-value")].map((input) => input.value.trim()).filter(Boolean);
}
function addManualSpecRow(container, value = "") {
  const row = document.createElement("div");
  row.className = "manual-spec-row";
  row.innerHTML = `<input class="manual-spec-value" value="${escapeHtml(value)}" placeholder="输入规格值" /><button class="ghost small-btn" type="button" data-action="remove-manual-spec">删除</button>`;
  container.appendChild(row);
  row.querySelector(".manual-spec-value").focus();
}
function setSubSpecEnabled(enabled) {
  const stocks = collectVariantStocks();
  els.subSpecSection.classList.toggle("hidden", !enabled);
  els.addSubSpecPrompt.classList.toggle("hidden", enabled);
  if (enabled && !els.subSpecRows.querySelector(".manual-spec-row")) addManualSpecRow(els.subSpecRows);
  if (!enabled) els.subSpecRows.innerHTML = "";
  renderVariantStockRows(stocks);
}
function variantConfigFromInputs() {
  return {
    main_spec_name: "",
    main_values: collectManualSpecValues(els.mainSpecRows),
    sub_spec_name: "",
    sub_values: els.subSpecSection.classList.contains("hidden") ? [] : collectManualSpecValues(els.subSpecRows),
  };
}
function previewVariantDefs(config) {
  const mains = config.main_values.length ? config.main_values : [""];
  const subs = config.sub_values.length ? config.sub_values : ["default"];
  return mains.flatMap((main) => subs.map((sub) => ({ main_spec: main, sub_spec: sub })));
}
function variantKey(variant) { return JSON.stringify([variant.main_spec, variant.sub_spec]); }

function setMovementType(type) {
  state.movementType = type;
  els.typeIn.classList.toggle("active", type === "in");
  els.typeOut.classList.toggle("active", type === "out");
  els.movementModalTitle.textContent = type === "in" ? "进货加库存" : "发货减库存";
  els.movementSubmit.textContent = type === "in" ? "加库存" : "减库存";
  els.reference.placeholder = type === "in" ? "采购单号" : "订单号";
  els.unitPrice.parentElement.style.display = type === "in" ? "grid" : "none";
}

function updateImagePreview(file) {
  if (state.productImagePreviewUrl) URL.revokeObjectURL(state.productImagePreviewUrl);
  if (!file) {
    state.productImagePreviewUrl = null; els.imagePreview.removeAttribute("src"); els.imagePreview.classList.add("hidden"); els.imagePasteText.textContent = "选择文件或直接粘贴图片"; return;
  }
  state.productImagePreviewUrl = URL.createObjectURL(file); els.imagePreview.src = state.productImagePreviewUrl; els.imagePreview.classList.remove("hidden"); els.imagePasteText.textContent = file.name || "已粘贴图片";
}
function setProductImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) { showAlert("请上传或粘贴图片文件"); return; }
  state.productImageFile = file;
  try { const transfer = new DataTransfer(); transfer.items.add(file); els.productImage.files = transfer.files; } catch { els.productImage.value = ""; }
  updateImagePreview(file); showAlert("");
}
function imageFromClipboard(event) { for (const item of event.clipboardData?.items || []) if (item.type.startsWith("image/")) return item.getAsFile(); return null; }

async function refreshAll() {
  showAlert("");
  const query = els.productSearch.value.trim();
  const [summary, products] = await Promise.all([api("/api/summary"), api(`/api/products${query ? `?q=${encodeURIComponent(query)}` : ""}`)]);
  state.products = products; renderSummary(summary); renderProducts(); renderProductOptions();
}
function renderSummary(summary) {
  els.metricProducts.textContent = formatNumber(summary.product_count); els.metricStock.textContent = formatNumber(summary.total_stock); els.metricIn.textContent = formatNumber(summary.total_in); els.metricOut.textContent = formatNumber(summary.total_out); els.metricLow.textContent = formatNumber(summary.low_stock_count);
}
function productById(id) { return state.products.find((product) => String(product.id) === String(id)); }
function renderProductOptions(selectedProductId = els.movementProduct.value) {
  els.movementProduct.innerHTML = "";
  for (const product of state.products) {
    const option = document.createElement("option"); option.value = product.id; option.textContent = `${product.sku} - ${product.name}（总库存 ${product.stock}${product.unit}）`; els.movementProduct.appendChild(option);
  }
  if (selectedProductId && productById(selectedProductId)) els.movementProduct.value = selectedProductId;
  renderVariantOptions();
}
function renderVariantOptions(selectedVariantId = els.movementVariant.value) {
  const product = productById(els.movementProduct.value);
  els.movementVariant.innerHTML = "";
  for (const variant of product?.variants || []) {
    const option = document.createElement("option"); option.value = variant.id; option.textContent = `${variantLabel(variant)}（库存 ${variant.stock}${product.unit}）`; els.movementVariant.appendChild(option);
  }
  if (selectedVariantId && [...els.movementVariant.options].some((option) => option.value === String(selectedVariantId))) els.movementVariant.value = selectedVariantId;
}

function clearVariantImageState() {
  for (const url of state.variantImagePreviewUrls.values()) URL.revokeObjectURL(url);
  state.variantImageFiles.clear();
  state.variantImagePreviewUrls.clear();
  state.variantExistingImages.clear();
}
function variantEditorImageMarkup(key) {
  const previewUrl = state.variantImagePreviewUrls.get(key) || state.variantExistingImages.get(key);
  return previewUrl
    ? `<img class="variant-upload-preview" src="${escapeHtml(previewUrl)}" alt="规格图片预览" />`
    : `<div class="variant-upload-preview variant-upload-empty">暂无图片</div>`;
}
function renderVariantStockRows(stocks = collectVariantStocks()) {
  const defs = previewVariantDefs(variantConfigFromInputs());
  els.variantStockRows.innerHTML = "";
  defs.forEach((variant) => {
    const row = document.createElement("div");
    row.className = "variant-stock-row";
    const key = variantKey(variant);
    row.dataset.variantKey = key;
    row.innerHTML = `
      <div class="variant-stock-identity"><span>${escapeHtml(variantLabel(variant))}</span></div>
      <label class="variant-quantity-field"><span>初始库存</span><input type="number" min="0" data-variant-key="${escapeHtml(key)}" value="${Number(stocks[key] || 0)}" /></label>
      <div class="variant-image-field">
        <span>规格图片</span>
        <div class="variant-image-zone" tabindex="0" data-variant-image-key="${escapeHtml(key)}">
          <div class="variant-image-zone-copy">
            <strong>选择文件或直接粘贴图片</strong>
            <span>复制图片后在这里按 Ctrl+V</span>
          </div>
          ${variantEditorImageMarkup(key)}
        </div>
        <input type="file" accept="image/*" data-variant-image-key="${escapeHtml(key)}" />
      </div>`;
    els.variantStockRows.appendChild(row);
  });
}
function collectVariantStocks() {
  return Object.fromEntries([...els.variantStockRows.querySelectorAll("input[data-variant-key]")].map((input) => [input.dataset.variantKey, input.value]));
}
function setVariantImageFile(key, file) {
  if (!file || !file.type.startsWith("image/")) {
    showAlert("规格图片只能上传图片文件");
    return;
  }
  const oldUrl = state.variantImagePreviewUrls.get(key);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  state.variantImageFiles.set(key, file);
  state.variantImagePreviewUrls.set(key, URL.createObjectURL(file));
  renderVariantStockRows();
  showAlert("");
}
function renderProducts() {
  els.productsTable.innerHTML = "";
  if (!state.products.length) { els.productsTable.innerHTML = `<tr><td class="empty" colspan="5">还没有商品，点击“新品入库”添加第一个 SKU。</td></tr>`; return; }
  for (const product of state.products) {
    const variants = product.variants?.length ? product.variants : [{ id: "", main_spec: "", sub_spec: "default", stock: product.stock, total_in: product.total_in, total_out: product.total_out }];
    variants.forEach((variant, index) => {
      const isLow = Number(variant.stock) <= Number(product.low_stock_threshold);
      const tr = document.createElement("tr"); tr.className = isLow ? "low-row" : "";
      const productCell = index === 0 ? `
        <td class="product-group-cell" rowspan="${variants.length}">
          <div class="product-main">${productImageMarkup(product)}<div><div class="product-name">${escapeHtml(product.name)}</div><div class="sku">${escapeHtml(product.sku)}</div><div class="subtle">${escapeHtml(product.note || "")}</div></div></div>
          <div class="product-total">商品总库存 <strong>${formatNumber(product.stock)}${escapeHtml(product.unit)}</strong></div>
          <div class="row-actions product-actions"><button class="ghost" type="button" data-action="edit-product" data-id="${product.id}">编辑商品</button><button class="danger" type="button" data-action="delete-product" data-id="${product.id}">删除商品</button></div>
        </td>` : "";
      const branchParts = [variant.main_spec, variant.sub_spec].filter((value) => value && value !== "default");
      const branchMarkup = branchParts.length ? branchParts.map((value) => `<span class="spec-value-badge">${escapeHtml(value)}</span>`).join(`<span class="variant-branch-separator">/</span>`) : `<span class="spec-value-badge">默认规格</span>`;
      const variantImage = branchParts.length ? (variant.image_url || product.image_url) : null;
      const variantImageMarkup = variantImage ? `<img class="variant-thumb" src="${escapeHtml(variantImage)}" alt="${escapeHtml(variantLabel(variant))}" loading="lazy" />` : (branchParts.length ? `<div class="variant-thumb variant-thumb-empty">无图</div>` : "");
      tr.innerHTML = `${productCell}
        <td><div class="variant-branch-cell">${variantImageMarkup}<div class="variant-branch">${branchMarkup}</div></div></td>
        <td><div class="stock-count ${isLow ? "low" : ""}">${formatNumber(variant.stock)}${escapeHtml(product.unit)}</div><div class="subtle">阈值 ${formatNumber(product.low_stock_threshold)}</div></td>
        <td>${formatNumber(variant.total_in)} / ${formatNumber(variant.total_out)}</td>
        <td><div class="row-actions"><button class="ghost" type="button" data-action="stock-in" data-id="${product.id}" data-variant-id="${variant.id}">进货 +</button><button class="ghost" type="button" data-action="stock-out" data-id="${product.id}" data-variant-id="${variant.id}">发货 -</button></div></td>`;
      els.productsTable.appendChild(tr);
    });
  }
}
function productImageMarkup(product) { return product.image_url ? `<img class="product-thumb" src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.sku)}" loading="lazy" />` : `<div class="product-thumb product-thumb-empty">${escapeHtml(product.sku.slice(0, 2).toUpperCase())}</div>`; }

function resetProductForm() {
  els.productId.value = ""; els.productForm.reset(); els.sku.value = ""; els.sku.placeholder = "系统自动生成"; state.productImageFile = null; updateImagePreview(null); clearVariantImageState();
  els.initialStock.value = "0"; els.unit.value = "件"; els.lowStock.value = "5"; els.productHappenedAt.value = today(); els.productNote.value = "";
  els.mainSpecRows.innerHTML = ""; addManualSpecRow(els.mainSpecRows); els.subSpecRows.innerHTML = ""; setSubSpecEnabled(false); els.variantStockRows.innerHTML = `<p class="subtle">添加规格值后，会自动生成库存分支。</p>`; els.productModalTitle.textContent = "新品入库"; els.initialStockLabel.classList.remove("hidden"); els.cancelProductEdit.classList.add("hidden"); els.productSaveBtn.textContent = "保存并入库";
}
function openNewProduct() { resetProductForm(); openModal(els.productModal); els.name.focus(); }
function editProduct(product) {
  const config = product.spec_config || { main_spec_name: product.main_spec_name || "", main_values: [], sub_spec_name: product.sub_spec_name || "", sub_values: [] };
  els.productId.value = product.id; els.productModalTitle.textContent = "编辑商品"; els.sku.value = product.sku; els.name.value = product.name; els.unit.value = product.unit; els.lowStock.value = product.low_stock_threshold; els.productHappenedAt.value = today(); els.productNote.value = product.note || ""; els.productImage.value = ""; state.productImageFile = null; updateImagePreview(null);
  clearVariantImageState(); (product.variants || []).forEach((variant) => { if (variant.image_url) state.variantExistingImages.set(variantKey(variant), variant.image_url); });
  els.mainSpecRows.innerHTML = ""; (config.main_values || []).forEach((value) => addManualSpecRow(els.mainSpecRows, value)); if (!els.mainSpecRows.children.length) addManualSpecRow(els.mainSpecRows);
  els.subSpecRows.innerHTML = ""; (config.sub_values || []).forEach((value) => addManualSpecRow(els.subSpecRows, value)); els.subSpecSection.classList.toggle("hidden", !(config.sub_values || []).length); els.addSubSpecPrompt.classList.toggle("hidden", Boolean((config.sub_values || []).length)); renderVariantStockRows(Object.fromEntries((product.variants || []).map((variant) => [variantKey(variant), variant.stock])));
  els.initialStockLabel.classList.add("hidden"); els.cancelProductEdit.classList.remove("hidden"); els.productSaveBtn.textContent = "保存商品"; openModal(els.productModal); els.name.focus();
}
function prepareMovement(product, type, variantId) { setMovementType(type); renderProductOptions(product.id); els.movementProduct.value = product.id; renderVariantOptions(variantId); els.movementVariant.value = variantId; els.quantity.value = "1"; els.happenedAt.value = today(); els.unitPrice.value = ""; els.reference.value = ""; els.movementNote.value = ""; openModal(els.movementModal); els.quantity.focus(); }
function buildProductFormData() {
  const formData = new FormData();
  if (els.productId.value) formData.append("sku", els.sku.value);
  formData.append("name", els.name.value);
  formData.append("unit", els.unit.value);
  formData.append("low_stock_threshold", els.lowStock.value);
  formData.append("note", els.productNote.value);
  formData.append("variant_config", JSON.stringify(variantConfigFromInputs()));
  formData.append("variant_stocks", JSON.stringify(collectVariantStocks()));
  formData.append("happened_at", els.productHappenedAt.value);
  if (!els.productId.value) formData.append("initial_stock", els.initialStock.value);
  const imageFile = state.productImageFile || els.productImage.files[0];
  if (imageFile) formData.append("image", imageFile);
  const variantImageKeys = {};
  let index = 0;
  for (const [key, file] of state.variantImageFiles) {
    const fieldName = `variant_image_${index++}`;
    variantImageKeys[fieldName] = key;
    formData.append(fieldName, file);
  }
  formData.append("variant_image_keys", JSON.stringify(variantImageKeys));
  return formData;
}
els.loginForm.addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/api/login", { method: "POST", body: JSON.stringify({ password: els.password.value }) }); state.authenticated = true; els.password.value = ""; showApp(); await refreshAll(); } catch (error) { showAlert(error.message); } });
els.logoutBtn.addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); state.authenticated = false; showLogin(); });
els.changePasswordBtn.addEventListener("click", () => { els.passwordForm.reset(); openModal(els.passwordModal); els.currentPassword.focus(); });
els.passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/change-password", { method: "POST", body: JSON.stringify({ current_password: els.currentPassword.value, new_password: els.newPassword.value, confirm_password: els.confirmPassword.value }) });
    closeModal(els.passwordModal);
    showAlert("密码修改成功，下次登录请使用新密码");
    els.passwordForm.reset();
  } catch (error) { showAlert(error.message); }
});
els.newProductBtn.addEventListener("click", openNewProduct);
els.productImage.addEventListener("change", () => { const file = els.productImage.files[0]; state.productImageFile = file || null; updateImagePreview(file || null); });
els.imagePasteZone.addEventListener("click", () => els.imagePasteZone.focus());
els.imagePasteZone.addEventListener("paste", (event) => { const file = imageFromClipboard(event); if (file) { event.preventDefault(); setProductImageFile(file); } });
els.addMainSpecValueBtn.addEventListener("click", () => addManualSpecRow(els.mainSpecRows));
els.enableSubSpecBtn.addEventListener("click", () => setSubSpecEnabled(true));
els.disableSubSpecBtn.addEventListener("click", () => setSubSpecEnabled(false));
els.addSubSpecValueBtn.addEventListener("click", () => addManualSpecRow(els.subSpecRows));
els.mainSpecRows.addEventListener("input", () => renderVariantStockRows());
els.subSpecRows.addEventListener("input", () => renderVariantStockRows());
els.mainSpecRows.addEventListener("click", (event) => {
  if (event.target.closest("[data-action='remove-manual-spec']")) {
    event.target.closest(".manual-spec-row")?.remove();
    if (!els.mainSpecRows.querySelector(".manual-spec-row")) addManualSpecRow(els.mainSpecRows);
    renderVariantStockRows();
  }
});
els.subSpecRows.addEventListener("click", (event) => {
  if (event.target.closest("[data-action='remove-manual-spec']")) {
    event.target.closest(".manual-spec-row")?.remove();
    if (!els.subSpecRows.querySelector(".manual-spec-row")) addManualSpecRow(els.subSpecRows);
    renderVariantStockRows();
  }
});
els.variantStockRows.addEventListener("change", (event) => {
  const input = event.target.closest("input[data-variant-image-key]");
  if (input?.files[0]) setVariantImageFile(input.dataset.variantImageKey, input.files[0]);
});
els.variantStockRows.addEventListener("click", (event) => {
  const zone = event.target.closest(".variant-image-zone");
  if (zone && !event.target.closest("input")) zone.focus();
});
els.variantStockRows.addEventListener("paste", (event) => {
  const zone = event.target.closest(".variant-image-zone");
  const file = imageFromClipboard(event);
  if (zone && file) {
    event.preventDefault();
    setVariantImageFile(zone.dataset.variantImageKey, file);
  }
});
els.productForm.addEventListener("submit", async (event) => { event.preventDefault(); try { await api(els.productId.value ? `/api/products/${els.productId.value}` : "/api/products", { method: els.productId.value ? "PUT" : "POST", body: buildProductFormData() }); closeModal(els.productModal); resetProductForm(); await refreshAll(); } catch (error) { showAlert(error.message); } });
els.cancelProductEdit.addEventListener("click", () => { closeModal(els.productModal); resetProductForm(); });
els.productSearch.addEventListener("input", async () => { try { await refreshAll(); } catch (error) { showAlert(error.message); } });
els.movementProduct.addEventListener("change", () => renderVariantOptions());
els.productsTable.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]"); if (!button) return; const product = productById(button.dataset.id); if (!product) return;
  if (button.dataset.action === "edit-product") editProduct(product);
  if (button.dataset.action === "stock-in") prepareMovement(product, "in", button.dataset.variantId);
  if (button.dataset.action === "stock-out") prepareMovement(product, "out", button.dataset.variantId);
  if (button.dataset.action === "delete-product") { if (!confirm(`确定删除 ${product.name} 吗？已有流水的商品不能删除。`)) return; try { await api(`/api/products/${product.id}`, { method: "DELETE" }); await refreshAll(); } catch (error) { showAlert(error.message); } }
});
els.typeIn.addEventListener("click", () => setMovementType("in")); els.typeOut.addEventListener("click", () => setMovementType("out"));
els.movementForm.addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/api/movements", { method: "POST", body: JSON.stringify({ type: state.movementType, product_id: els.movementProduct.value, variant_id: els.movementVariant.value, quantity: els.quantity.value, happened_at: els.happenedAt.value, unit_price: els.unitPrice.value, reference: els.reference.value, note: els.movementNote.value }) }); closeModal(els.movementModal); await refreshAll(); } catch (error) { showAlert(error.message); } });
document.addEventListener("click", (event) => { if (event.target.closest("[data-close-modal]") || event.target.classList.contains("modal-backdrop")) closeAllModals(); });
document.addEventListener("paste", (event) => {
  if (els.productModal.classList.contains("hidden")) return;
  const file = imageFromClipboard(event);
  if (!file) return;
  const zone = event.target.closest?.(".variant-image-zone");
  event.preventDefault();
  if (zone) {
    setVariantImageFile(zone.dataset.variantImageKey, file);
    return;
  }
  setProductImageFile(file);
});
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeAllModals(); });

async function boot() {
  els.happenedAt.value = today(); els.productHappenedAt.value = today(); setMovementType("in");
  try { const me = await api("/api/me", { showLoginOnUnauthorized: false }); state.authenticated = Boolean(me.authenticated); } catch { state.authenticated = false; }
  if (state.authenticated) { showApp(); await refreshAll(); } else showLogin();
}
boot();
