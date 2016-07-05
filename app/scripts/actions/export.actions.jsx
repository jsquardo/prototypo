import {prototypoStore} from '../stores/creation.stores.jsx';
import LocalServer from '../stores/local-server.stores.jsx';
import LocalClient from '../stores/local-client.stores.jsx';
import {FontValues} from '../services/values.services.js';
import HoodieApi from '../services/hoodie.services.js';
import JSZip from 'jszip';

let localServer;
let localClient;

window.addEventListener('fluxServer.setup', () => {
	localClient = LocalClient.instance();
	localServer = LocalServer.instance;
});

export default {
	'/exporting': ({exporting, errorExport}) => {
		const patch = prototypoStore.set('export', exporting).set('errorExport', errorExport).commit();

		localServer.dispatchUpdate('/prototypoStore', patch);
	},
	'/export-otf': ({merged}) => {
		localClient.dispatchAction('/exporting', {exporting: true});

		const family = prototypoStore.get('family').name ? prototypoStore.get('family').name.replace(/\s/g, '-') : 'font';
		const style = prototypoStore.get('variant').name ? prototypoStore.get('variant').name.replace(/\s/g, '-') : 'regular';

		const name = {
			family,
			style: `${style.toLowerCase()}`,
		};

		const exportingError = setTimeout(() => {
			localClient.dispatchAction('/exporting', {exporting: false, errorExport: true});
		}, 10000);

		fontInstance.download(() => {
			localClient.dispatchAction('/store-value', {uiOnboardstep: 'end'});
			localClient.dispatchAction('/exporting', {exporting: false});
			window.Intercom('trackEvent', 'export-otf');
			clearTimeout(exportingError);
		}, name, merged, undefined, HoodieApi.instance.email);
	},
	'/export-glyphr': () => {
		const family = prototypoStore.get('family').name ? prototypoStore.get('family').name.replace(/\s/g, '-') : 'font';
		const style = prototypoStore.get('variant').name ? prototypoStore.get('variant').name.replace(/\s/g, '-') : 'regular';

		const name = {
			family,
			style: `${style.toLowerCase()}`,
		};

		fontInstance.openInGlyphr(null, name, false, undefined, HoodieApi.instance.email);
	},
	'/export-family': async ({familyToExport, variants}) => {
		const oldVariant = prototypoStore.get('variant');
		const family = prototypoStore.get('family');
		const zip = new JSZip();
		const a = document.createElement('a');

		const setupPatch = prototypoStore
			.set('familyExported', familyToExport.name)
			.set('variantToExport', variants.length)
			.commit();

		localServer.dispatchUpdate('/prototypoStore', setupPatch);

		fontInstance.exportingZip = true;
		fontInstance._queue = [];

		localClient.dispatchAction('/change-font', {
			templateToLoad: familyToExport.template,
			db: 'default',
		});

		fontInstance.addOnceListener('worker.fontLoaded', () => {

			const values = [];

			for (let i = 0; i < variants.length; i++) {
				const currVariant = variants[i];

				values.push(FontValues.get({typeface: currVariant.db})
					.then((fontValues) => {
						return {
							currVariant,
							fontValues,
						};
					})
				);
			}

			const blobs = [];

			Promise.all(values).then((valueArray) => {
				_.each(valueArray, (value) => {
					const blob = fontInstance.getBlob(
						null, {
							family: familyToExport.name,
							style: value.currVariant.name,
						},
						false,
						value.fontValues.values
					);

					blobs.push(blob.then((blob) => {
						return blob;
					}));
				});

				Promise.all(blobs).then((blobBuffers) => {
					_.each(blobBuffers, ({buffer, variant}) => {
						const variantPatch = prototypoStore.set('exportedVariant',
							prototypoStore.get('exportedVariant') + 1).commit();

						localServer.dispatchUpdate('/prototypoStore', variantPatch);
						zip.file(`${variant}.otf`, buffer, {binary: true});
					});
					const reader = new FileReader();
					const _URL = window.URL || window.webkitURL;

					reader.onloadend = () => {
						a.download = `${familyToExport.name}.zip`;
						a.href = reader.result;
						a.dispatchEvent(new MouseEvent('click'));

						setTimeout(() => {
							a.href = '#';
							_URL.revokeObjectURL(reader.result);
						}, 100);

						fontInstance.exportingZip = false;

						localClient.dispatchAction('/change-font', {
							templateToLoad: family.template,
							db: oldVariant.db,
						});

						const cleanupPatch = prototypoStore
							.set('variantToExport', undefined)
							.set('exportedVariant', 0)
							.set('familyExported', undefined)
							.commit();

						localServer.dispatchUpdate('/prototypoStore', cleanupPatch);
					};

					reader.readAsDataURL(zip.generate({type: "blob"}));
				});
			});
		});
	},
};
