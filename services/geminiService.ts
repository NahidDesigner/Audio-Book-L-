
import { GoogleGenAI, Modality, Type } from "@google/genai";

const getAI = () => {
  const apiKey = (process.env as any).API_KEY;
  if (!apiKey) throw new Error("API Key configuration is missing.");
  return new GoogleGenAI({ apiKey });
};

export const generateAudioFromText = async (text: string, voiceName: string): Promise<string> => {
  const ai = getAI();
  try {
    const isBengali = /[\u0980-\u09FF]/.test(text);
    const contextInstruction = isBengali 
      ? "You are a professional Bengali audiobook narrator. Read the following text with proper pauses and natural intonation in Bengali:"
      : "You are a professional audiobook narrator. Read the following text clearly and naturally:";

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `${contextInstruction}\n\n${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part?.inlineData?.data) throw new Error("No audio data generated.");
    return part.inlineData.data;
  } catch (error: any) {
    throw new Error(error.message || "Synthesis failed.", { cause: error });
  }
};

export const analyzeChapter = async (chapterTitle: string, fullText: string) => {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze the following book chapter titled "${chapterTitle}". 
      
      CRITICAL INSTRUCTION: You MUST provide the summary and the questions in the SAME LANGUAGE as the provided text. 
      If the text is in Bengali, respond in Bengali. If it is in English, respond in English.
      
      Provide a concise summary and 3 thought-provoking questions.
      
      CHAPTER TEXT:
      ${fullText}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            questions: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["summary", "questions"]
        }
      }
    });
    
    return JSON.parse(response.text);
  } catch (error: any) {
    throw new Error("Analysis failed: " + error.message, { cause: error });
  }
};
