"""Second removal pass on a plate, for example removing a pier and all its props to leave open sea.
Same as run_plate.py with the prefix "sea" and the source defaulting to plate/plate-3.png:
  python run_seaplate.py --remove "the entire wooden pier, all posts and the props on it" --src plate/plate-3.png
Writes plate/sea-<k>.png."""
import run_plate
if __name__ == '__main__':
    run_plate.main(defaults={'prefix': 'sea', 'src': 'plate/plate-3.png'})
