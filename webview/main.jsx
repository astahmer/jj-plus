import { render } from 'solid-js/web';
import { onMount } from 'solid-js';
import './timeline.css';

function loadLegacyScript(src, flagName) {
  if (!src) {
    return Promise.resolve();
  }

  if (globalThis[flagName]) {
    return globalThis[flagName];
  }

  globalThis[flagName] = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-timeline-asset="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }

      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.timelineAsset = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
    document.body.appendChild(script);
  });

  return globalThis[flagName];
}

function App() {
  let host;

  onMount(async () => {
    const mountRoot = document.getElementById('timelineApp');
    const templateSrc = mountRoot ? mountRoot.dataset.templateSrc : '';
    const hostBridgeSrc = mountRoot ? mountRoot.dataset.hostBridgeSrc : '';

    await loadLegacyScript(templateSrc, '__timelineTemplateScriptPromise');
    await loadLegacyScript(hostBridgeSrc, '__timelineHostBridgeScriptPromise');

    const template = globalThis.TimelineTemplate;

    if (!host || !template || typeof template.renderTimelineBodyHtml !== 'function') {
      if (host) {
        host.innerHTML = '<div class="app"><div class="empty">Timeline template failed to load.</div></div>';
      }
      return;
    }

    host.innerHTML = template.renderTimelineBodyHtml();

    const modelSrc = mountRoot ? mountRoot.dataset.legacyModelSrc : '';
    const controllerSrc = mountRoot ? mountRoot.dataset.legacyControllerSrc : '';
    await loadLegacyScript(modelSrc, '__timelineModelScriptPromise');
    await loadLegacyScript(controllerSrc, '__timelineControllerScriptPromise');
  });

  return <div ref={host} />;
}

const mountRoot = document.getElementById('timelineApp');

if (mountRoot) {
  render(() => <App />, mountRoot);
}
