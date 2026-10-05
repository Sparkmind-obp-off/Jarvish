const button = document.querySelector<HTMLButtonElement>("#talk");
const status = document.querySelector<HTMLElement>("#status");

button?.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    if (status) status.textContent = "Microphone is not supported in this browser.";
    return;
  }
  await navigator.mediaDevices.getUserMedia({ audio: true });
  if (status) status.textContent = "Microphone connected. Voice runtime adapter pending.";
});