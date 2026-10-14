// Carry the explored amount into the existing contact message and endpoint.
(() => {
  const slider = document.getElementById('fundingAmount');
  const display = document.getElementById('fundingDisplay');
  const format = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  function updateAmount() {
    const amount = Number(slider.value);
    display.textContent = format.format(amount);
    slider.setAttribute('aria-valuetext', `${amount.toLocaleString('en-CA')} Canadian dollars`);
  }
  slider.addEventListener('input', updateAmount);
  updateAmount();
  const message = document.querySelector('#contactForm textarea[name="message"]');
  const options = document.getElementById('fundingOptions');
  let amountLine = '';
  options.addEventListener('click', () => {
    // Only replace our own line; preserve any text the visitor has written.
    const lines = message.value.split('\n');
    const previousIndex = amountLine ? lines.indexOf(amountLine) : -1;
    amountLine = `Requested funding amount: ${format.format(Number(slider.value))} CAD`;
    if (previousIndex !== -1) lines[previousIndex] = amountLine;
    else lines.unshift(amountLine);
    message.value = lines.join('\n');
  });
})();
