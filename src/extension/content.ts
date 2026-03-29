// Content script for Autoply Copilot

console.log('Autoply content script active');

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'OK' });
    return true;
  }

  if (message.type === 'GET_PAGE_DATA') {
    sendResponse({
      url: window.location.href,
      html: document.documentElement.outerHTML,
      title: document.title
    });
    return true;
  }
  
  if (message.type === 'AUTOFILL_FORM') {
    const { fillPlan, documents } = message;
    console.log('Autoply: Starting autofill', { fillPlan, hasDocs: !!documents });
    
    const inputs = Array.from(document.querySelectorAll('input, textarea, select')) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
    
    // 1. Text/Choice Fields
    for (const [key, value] of Object.entries(fillPlan)) {
      const targetValue = value as string;
      
      const found = inputs.find(input => {
        const name = input.name?.toLowerCase() || '';
        const id = input.id?.toLowerCase() || '';
        const placeholder = 'placeholder' in input ? (input as HTMLInputElement).placeholder?.toLowerCase() || '' : '';
        const ariaLabel = input.getAttribute('aria-label')?.toLowerCase() || '';
        const k = key.toLowerCase();
        
        // Find label text
        let labelText = '';
        if (input.id) {
          const label = document.querySelector(`label[for="${input.id}"]`);
          labelText = label?.textContent?.toLowerCase() || '';
        }
        if (!labelText) {
          labelText = input.closest('label')?.textContent?.toLowerCase() || '';
        }

        return (
          name.includes(k) || 
          id.includes(k) || 
          placeholder.includes(k) || 
          ariaLabel.includes(k) ||
          labelText.includes(k)
        );
      });

      if (found) {
        console.log(`Autoply: Filling ${key} -> ${found.name || found.id}`);
        if (found.type === 'checkbox' || found.type === 'radio') {
          const shouldCheck = targetValue.toLowerCase() === 'yes' || targetValue.toLowerCase() === 'true';
          (found as HTMLInputElement).checked = shouldCheck;
        } else {
          found.value = targetValue;
        }
        found.dispatchEvent(new Event('input', { bubbles: true }));
        found.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 2. File Uploads
    if (documents) {
      const fileInputs = inputs.filter(i => i.type === 'file') as HTMLInputElement[];
      
      const uploadFile = (input: HTMLInputElement, base64: string, filename: string) => {
        const byteString = atob(base64.split(',')[1] || base64);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], { type: 'application/pdf' });
        const file = new File([blob], filename, { type: 'application/pdf' });
        
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      for (const input of fileInputs) {
        const context = (input.name + input.id + (input.closest('label')?.textContent || '')).toLowerCase();
        if (context.includes('resume') || context.includes('cv')) {
          uploadFile(input, documents.resume, 'resume.pdf');
        } else if (context.includes('cover') || context.includes('letter')) {
          uploadFile(input, documents.coverLetter, 'cover_letter.pdf');
        }
      }
    }
    
    sendResponse({ success: true });
    return true;
  }
});
