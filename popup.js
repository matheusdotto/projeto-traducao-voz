const keyInput = document.getElementById("key");
const languageSelect = document.getElementById("language");
const myLanguageSelect = document.getElementById("my-language");
const saved = document.getElementById("saved");

chrome.storage.local
  .get(["apiKey", "targetLanguage", "myLanguage"])
  .then(({ apiKey, targetLanguage, myLanguage }) => {
    keyInput.value = apiKey ?? "";
    languageSelect.value = targetLanguage ?? "en";
    myLanguageSelect.value = myLanguage ?? "pt-BR";
  });

async function save() {
  await chrome.storage.local.set({
    apiKey: keyInput.value.trim(),
    targetLanguage: languageSelect.value,
    myLanguage: myLanguageSelect.value,
  });
  saved.textContent = "Salvo.";
}

keyInput.addEventListener("change", save);
languageSelect.addEventListener("change", save);
myLanguageSelect.addEventListener("change", save);
