import type { GeneratedFile } from '../types';

/**
 * Parses JSON array from model output, handling common formatting issues
 */
export function parseModelJSON(output: string): GeneratedFile[] {
  // Try to find JSON array in the output
  const jsonMatch = output.match(/\[[\s\S]*\]/);
  
  if (!jsonMatch) {
    throw new Error('No JSON array found in model output. Ensure the model outputs valid JSON array format.');
  }

  const jsonString = jsonMatch[0];
  
  try {
    const parsed = JSON.parse(jsonString);
    
    if (!Array.isArray(parsed)) {
      throw new Error('Parsed JSON is not an array');
    }

    // Validate and normalize file objects
    const files: GeneratedFile[] = parsed.map((item: any, idx: number) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Item at index ${idx} is not an object`);
      }
      
      if (typeof item.path !== 'string' || !item.path) {
        throw new Error(`Item at index ${idx} missing "path" string field`);
      }
      
      if (typeof item.content !== 'string') {
        throw new Error(`Item at index ${idx} missing "content" string field`);
      }

      return {
        path: item.path,
        content: item.content,
      };
    });

    return files;
  } catch (e: any) {
    console.error('JSON Parse Error:', e);
    console.error('Raw output:', output.substring(0, 500));
    throw new Error(`Failed to parse model JSON: ${e.message}`);
  }
}
