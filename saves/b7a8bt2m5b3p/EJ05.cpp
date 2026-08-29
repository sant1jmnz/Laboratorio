#include <iostream>
#include <fstream>
#include <cstring>

using namespace std;

struct FECHA_NAC {
    int dia;
    int mes;
    int anio;
};

struct ALUMNO {
    int id;
    char nombre[30];
    float nota;
    FECHA_NAC fechaNa
};

void GuardarEnBinario(ALUMNO a, int pos) {
    fstream file("alumnos.dat", ios::in | ios::out | ios::binary);

    if (!file.fail()) {
        file.seekp(pos * sizeof(ALUMNO), ios::beg);
        file.write((char*)&a, sizeof(ALUMNO));
        file.close();
    } else {
        ofstream crear("alumnos.dat", ios::binary);
        crear.write((char*)&a, sizeof(ALUMNO));
        crear.close();
    }
}
        if (file.read((char*)&a, sizeof(ALUMNO))) {
            cout << "\n--- Alumno en posicion " << pos << " ---" << endl;
            cout << "ID: " << a.id << endl;
            cout << "Nombre: " << a.nombre << endl;
            cout << "Nota: " << a.nota << endl;
            cout << "Fecha Nacimiento: " << a.fechaNac.dia << "/" << a.fechaNac.mes << "/" << a.fechaNac.anio << endl;
        } else {
            cout << "No se encontro ningun registro en la posicion " << pos << endl;
        }

        file.close();
    }
}

int main() {
    ALUMNO a1 = {1, "Santiago", 9.5, {12, 5, 2008}};
    ALUMNO a2 = {2, "Lucas", 8.0, {20, 10, 2007}};

    GuardarEnBinario(a1, 0);
    GuardarEnBinario(a2, 1);

    LeerDeBinario(1);
    LeerDeBinario(0);

    return 0;
}