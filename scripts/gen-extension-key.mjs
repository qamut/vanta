// Gera o par de chaves que fixa o ID da extensão Chromium.
// Só a chave PÚBLICA é guardada (campo "key" do manifest); a privada é descartada:
// ela só seria necessária para empacotar um .crx, o que o VANTA não faz.
import { generateKeyPairSync, createHash } from "node:crypto";

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const der = publicKey.export({ type: "spki", format: "der" });
const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
const id = [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
console.log(JSON.stringify({ key: der.toString("base64"), id }, null, 2));
